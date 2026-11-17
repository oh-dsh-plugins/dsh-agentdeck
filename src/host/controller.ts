import { createHash } from 'node:crypto';
import { open, readFile, readdir, realpath } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBuiltinAgents, loadBuiltinSkills, resolveCatalog, parseOverrideText, agentRevision, resolveContextBudget } from '../core/index.js';
import type { AgentDefinition } from '../core/index.js';
import { rolePresentation } from '../core/presentation.js';
import { setupRoleIds, setupRoute, recommendRole, setupResources, normalizeSetupStrategy, setupStrategyRoutes, recommendStrategyRole } from './setup.js';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm';
import type { SubagentCatalogEntry } from '@deepseek-ai/dsh-subagent';
import { AgentDeckStore, textRevision } from './store.js';
import { NativeDelegator, NativeDelegationFailure } from './native.js';
import { SnapshotPresets } from './presets.js';
import { currentSelection, delegationSelection, modelDirectory, modelView, sessionRoutes, routeAuthorization, ModelAuthorizationError } from './models.js';
import { missingCapabilities } from './capabilities.js';
import { readRunResult } from './results.js';
import { roleChoice } from './selection.js';
import { inspectBrowserSupport, type BrowserEvidence } from './browser.js';
import { browserReadiness } from './browser-runtime.js';
import { object, requiredString, optionalString, messageOf, jsonClone } from './types.js';
import type { HostContext, RuntimeAgent, RoleSnapshot, RunRecord, JsonObject, EffectiveSelection } from './types.js';

export interface AgentDeckConfig { customAgentDirs?: string[]; projectConfigDirectory?: string; allowNativeFallback?: boolean }
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function admissionBudget(input: Parameters<typeof resolveContextBudget>[0]) {
  // Fixed prompt/tool cost is measured only after the real child scope assembles.
  const { materialTokens: _unmeasured, ...budget } = resolveContextBudget(input);
  return budget;
}

export class AgentDeckController {
  private readonly native: NativeDelegator;
  private readonly presets: SnapshotPresets;
  private readonly starts = new Map<string, Promise<JsonObject>>();
  private readonly builtinIds = new Set(loadBuiltinAgents().map(role => role.id));
  readonly diagnostics: string[] = [];
  constructor(readonly ctx: HostContext, readonly store: AgentDeckStore, readonly config: AgentDeckConfig = {}) {
    this.native = new NativeDelegator(ctx);
    this.presets = new SnapshotPresets(ctx);
  }
  async restore(): Promise<void> {
    for (const snapshot of this.store.snapshots()) {
      try { await this.presets.register(snapshot); }
      catch (error) { this.diagnostics.push(`${snapshot.presetId}: ${messageOf(error)}`); }
    }
  }
  agent(sessionId?: string): RuntimeAgent | undefined {
    if (!sessionId) return undefined;
    return this.ctx.agents.get(sessionId as any) as RuntimeAgent | undefined;
  }
  private cwd(agent?: RuntimeAgent): string | undefined {
    const directories = this.ctx.get('workingDirectory') as any;
    return agent ? directories?.get(agent.session) ?? agent.session.header.cwd : undefined;
  }
  private async overrides(agent?: RuntimeAgent): Promise<{ source: string; text: string; failure?: string }[]> {
    const values: { source: string; text: string; failure?: string }[] = this.store.overrides().map(value => ({ source: `user:${value.id}`, text: value.text }));
    const cwd = this.cwd(agent);
    const folders = [...(this.config.customAgentDirs ?? []), ...(cwd ? [join(cwd, this.config.projectConfigDirectory ?? '.dsh/agentdeck')] : [])];
    for (const folder of folders) {
      let names: string[];
      try {
        names = (await readdir(folder)).filter(name => /\.ya?ml$/i.test(name)).sort();
        if (names.length > 100) throw new Error('More than 100 role files; reduce the directory before loading.');
      } catch (error) {
        if ((error as any).code !== 'ENOENT') values.push({ source: folder, text: '', failure: messageOf(error) });
        continue;
      }
      for (const name of names) {
        const path = join(folder, name);
        let handle;
        let prefix = '';
        try {
          handle = await open(path, 'r');
          const info = await handle.stat();
          if (!info.isFile()) throw new Error('Role definition must be a regular UTF-8 file.');
          const maximum = info.size > 1_048_576 ? 65_536 : 1_048_577;
          const buffer = Buffer.alloc(maximum);
          let bytesRead = 0;
          while (bytesRead < maximum) {
            const chunk = await handle.read(buffer, bytesRead, maximum - bytesRead, bytesRead);
            if (!chunk.bytesRead) break;
            bytesRead += chunk.bytesRead;
          }
          prefix = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead), { stream: info.size > 1_048_576 });
          if (info.size > 1_048_576 || bytesRead > 1_048_576) {
            prefix = prefix.slice(0, prefix.lastIndexOf('\n') + 1);
            throw new Error('Role definition exceeds the 1 MiB limit.');
          }
          const after = await handle.stat();
          if (after.size !== info.size || after.mtimeMs !== info.mtimeMs) throw new Error('Role definition changed while loading; retry after the edit finishes.');
          values.push({ source: path, text: prefix });
        } catch (error) { values.push({ source: path, text: prefix, failure: messageOf(error) }); }
        finally { await handle?.close(); }
      }
    }
    return values;
  }
  private async resolved(agent?: RuntimeAgent) {
    const layers = await this.overrides(agent);
    const catalog = resolveCatalog(layers);
    const blockers = catalog.diagnostics.filter(diagnostic => !diagnostic.id && layers.some(layer => layer.failure && layer.source === diagnostic.source));
    return { ...catalog, layers, blockers };
  }
  private names(): string[] {
    // An advisory page read must not initialize every dynamic tool provider.
    // Actual child scopes still resolve and enforce their own executable tools.
    return this.ctx.tools.definitions().map((definition: any) => definition.name);
  }
  private roleView(role: AgentDefinition, names: string[], blocked = false, evidence?: BrowserEvidence) {
    const files = !!this.ctx.get('fs' as any) && !!this.ctx.get('workingDirectory' as any);
    const missing = missingCapabilities(role, names, { files, runner: files && !!this.ctx.get('subprocess' as any), skills: !!this.ctx.get('skills' as any), meter: !!this.ctx.get('tokenMeter' as any), web: !!this.ctx.get('web' as any) });
    const browserCaps = role.capabilities.filter(value => value.startsWith('browser-'));
    const browserSupport = browserCaps.length ? inspectBrowserSupport(names, role.capabilities, evidence ?? { bsk: { state: 'unverified', reason: 'BrowserSkill requires activation in the independent child before tool permission freeze, plus CLI/extension readiness. Script-only Computer Use is not adapted. No live connection was probed by this list read.' } }) : undefined;
    const unverified = [...missing.filter(value => value === 'web-research'), ...(browserSupport && browserSupport.state !== 'ready' ? browserCaps : [])];
    const required = missing.filter(value => !['web-research', 'browser-observe', 'browser-interact'].includes(value));
    return { ...role, presentation: rolePresentation(role), revision: agentRevision(role), available: role.enabled && required.length === 0 && unverified.length === 0 && !blocked, missingCapabilities: required, unverifiedCapabilities: unverified, capabilityCheck: 'static', ...(browserSupport ? { browserSupport } : {}), builtin: this.builtinIds.has(role.id) };
  }
  private selectionView(view: ReturnType<AgentDeckController['roleView']>, choice: ReturnType<typeof roleChoice>, authorization: JsonObject) {
    return { ...view, capabilitiesAvailable: view.available, available: view.available && authorization.status === 'authorized',
      ...(choice.configured ? { configuredSelection: choice.configured } : {}), authorization };
  }
  async catalog(agent?: RuntimeAgent, signal = new AbortController().signal): Promise<JsonObject> {
    const catalog = await this.resolved(agent);
    signal.throwIfAborted();
    const names = this.names();
    const parent = delegationSelection(agent);
    const routes = await sessionRoutes(this.ctx, agent, signal);
    signal.throwIfAborted();
    return {
      agents: catalog.agents.map(role => {
        const choice = roleChoice(role, parent);
        const source = catalog.layers.find(layer => { if (layer.source.startsWith('user:')) return false; try { return parseOverrideText(layer.text).id === role.id; } catch { return false; } })?.source;
        return { ...this.selectionView(this.roleView(role, names, catalog.blockers.length > 0), choice,
          routeAuthorization(choice.configured, parent, routes, !!agent, choice.explicit)), ...(source ? { source } : {}) };
      }),
      diagnostics: [...catalog.diagnostics, ...this.diagnostics.map(message => ({ message }))],
      overrides: this.store.overrides(),
      runtime: { compatibilityVersion: '0.2.2-rc.3', nativeProvider: !!this.ctx.subagents.getProvider('spawn'), storage: true },
      sessions: this.ctx.agents.list().filter(item => this.ctx.subagents.rootOf(item) === item).map(item => ({ id: item.id, cwd: this.cwd(item) })),
    };
  }
  async models(agent?: RuntimeAgent, request: JsonObject = {}, signal?: AbortSignal): Promise<JsonObject> {
    const provider = optionalString(request.provider, 'provider');
    const model = optionalString(request.model, 'model');
    if (model !== undefined && provider === undefined) throw new Error('A model metadata query requires its provider.');
    if (request.view !== undefined && request.view !== 'options') throw new Error('Unknown model directory view.');
    const result = await modelDirectory(this.ctx, agent, provider ? { provider, ...(model ? { model } : {}) } : undefined, signal, request.view === 'options');
    return provider ? { ...result, models: result.models.filter((value: any) => value.provider === provider) } : result;
  }
  private async role(id: string, agent?: RuntimeAgent): Promise<AgentDefinition> {
    const catalog = await this.resolved(agent);
    if (catalog.blockers.length) throw new Error(`Role source cannot be read safely: ${catalog.blockers.map(value => `${value.source}: ${value.message}`).join('; ')}`);
    const role = catalog.agents.find(value => value.id === id);
    if (!role) throw new Error(`Unknown or invalid AgentDeck role "${id}". Choose general explicitly for an unmatched task; a misspelled role is not a fallback request.`);
    if (!role.enabled) throw new Error(`AgentDeck role "${id}" is disabled.`);
    return role;
  }
  private async authorization(configured: EffectiveSelection | undefined, agent: RuntimeAgent | undefined, explicit: boolean, signal?: AbortSignal): Promise<JsonObject> {
    const routes = await sessionRoutes(this.ctx, agent, signal);
    signal?.throwIfAborted();
    return routeAuthorization(configured, delegationSelection(agent), routes, !!agent, explicit);
  }
  private async resolveConfig(configured: EffectiveSelection, signal?: AbortSignal): Promise<EffectiveSelection> {
    const { reasoningEffort, ...config } = configured;
    return this.ctx.llm.resolveCallConfig({ ...config, ...(reasoningEffort ? { reasoningEffort: ReasoningEffortId(reasoningEffort) } : {}) }, signal);
  }
  private async selection(role: AgentDefinition, agent: RuntimeAgent, request: JsonObject, signal?: AbortSignal, requireRevision = false) {
    const parent = delegationSelection(agent);
    if (!parent) throw new Error('The calling Session has no effective model. Configure a native model before delegating.');
    const choice = roleChoice(role, parent, request, requireRevision);
    const configured = choice.configured!;
    const authorization = await this.authorization(configured, agent, choice.explicit, signal);
    if (authorization.status !== 'authorized') throw new ModelAuthorizationError(authorization);
    const llm = this.ctx.get('llm') as any;
    if (!llm) throw new Error('Native model runtime is unavailable.');
    const effective = await this.resolveConfig(configured, signal);
    const metadata = await llm.resolveModelInfo(configured.provider, configured.model, signal);
    const nativeFields = choice.explicit ? { provider: configured.provider, model: configured.model, ...(effective.reasoningEffort ? { reasoning_effort: effective.reasoningEffort } : {}) } : {};
    return { effective, metadata, nativeFields, choice };
  }
  async candidates(id: string, agent?: RuntimeAgent, signal = new AbortController().signal): Promise<JsonObject> {
    const role = await this.role(id, agent);
    signal.throwIfAborted();
    const routes = agent ? await sessionRoutes(this.ctx, agent, signal) : undefined;
    const parent = delegationSelection(agent);
    return { id: role.id, revision: agentRevision(role), mode: role.model.mode, defaultCandidate: role.model.defaultCandidate,
      candidates: (role.model.candidates ?? []).map(candidate => ({ id: candidate.id, purpose: candidate.purpose, provider: candidate.provider, model: candidate.model,
        reasoning: candidate.reasoning, maxTokens: candidate.maxTokens,
        authorization: routeAuthorization(candidate, parent, routes, !!agent, true).status })) };
  }
  async preview(id: string, agent?: RuntimeAgent, signal = new AbortController().signal, request: JsonObject = {}): Promise<JsonObject> {
    signal.throwIfAborted();
    const role = await this.role(id, agent);
    const browserEvidence = role.capabilities.some(capability => capability.startsWith('browser-'))
      ? { bsk: await browserReadiness(this.ctx, signal) } : undefined;
    const view = this.roleView(role, this.names(), false, browserEvidence);
    const diagnostics: string[] = [];
    let choice: ReturnType<typeof roleChoice>;
    try { choice = roleChoice(role, delegationSelection(agent), request); }
    catch (error) { const authorization = { status: 'unknown' }; return { agent: { ...view, capabilitiesAvailable: view.available, available: false, authorization }, budget: admissionBudget(role.context), authorization, output: { source: 'unknown', validated: false }, capacity: { kind: 'unknown', assemblyChecked: false }, diagnostics: [messageOf(error)] }; }
    const configured = choice.configured;
    let metadata: JsonObject | undefined;
    let effective: EffectiveSelection | undefined;
    const authorization = await this.authorization(configured, agent, choice.explicit, signal);
    if (configured) {
      try { metadata = await this.ctx.llm.resolveModelInfo(configured.provider, configured.model, signal); }
      catch (error) { signal.throwIfAborted(); diagnostics.push(`Model declaration: ${messageOf(error)}`); }
      if (agent) {
        if (authorization.status !== 'authorized') {
          if (authorization.message) diagnostics.push(authorization.message);
        } else {
          try { effective = await this.resolveConfig(configured, signal); }
          catch (error) { signal.throwIfAborted(); diagnostics.push(`Native parameter validation: ${messageOf(error)}`); }
        }
      } else diagnostics.push('Select a live Session to validate authorization and effective output parameters. Model declarations and configured capacity are not task admission.');
    } else diagnostics.push('Select a live Session to resolve inherited model parameters.');
    const outputTokens = effective?.maxTokens ?? configured?.maxTokens ?? metadata?.defaultMaxTokens;
    return { agent: this.selectionView(view, choice, authorization), ...(metadata ? { model: modelView(metadata, agent ? authorization.status === 'authorized' : null) } : {}),
      ...(configured ? { configuredSelection: configured } : {}), ...(effective ? { effectiveSelection: effective } : {}), sessionSelection: currentSelection(agent),
      authorization,
      output: { configuredMaxTokens: configured?.maxTokens, effectiveMaxTokens: effective?.maxTokens ?? (effective ? metadata?.defaultMaxTokens : undefined),
        source: choice.outputSource === 'unknown' && outputTokens !== undefined ? 'native-default' : choice.outputSource, validated: effective !== undefined },
      capacity: { kind: effective ? 'validated-parameters' : metadata && outputTokens !== undefined ? 'configured' : 'unknown', assemblyChecked: false },
      budget: admissionBudget({ ...role.context, windowTokens: metadata?.context?.contextWindow, outputTokens }), diagnostics };
  }
  async recommend(request: JsonObject, actor?: RuntimeAgent, signal = new AbortController().signal): Promise<JsonObject> {
    const ids = setupRoleIds(request.roleIds);
    if (request.strategy !== undefined) return this.recommendStrategy(request, actor, signal);
    if (request.scopePolicy !== undefined || request.browserStrategy !== undefined || request.resourceMigration !== undefined) throw new Error('A strategy is required for the new setup request.');
    const defaultRoute = setupRoute(request.defaultRoute);
    const imageRoute = request.imageRoute === undefined ? defaultRoute : setupRoute(request.imageRoute);
    if (request.includeBrowser !== undefined && typeof request.includeBrowser !== 'boolean') throw new Error('includeBrowser must be boolean.');
    const current = await this.resolved(actor);
    if (current.blockers.length) throw new Error('Resolve unreadable role sources before generating settings.');
    const routes = [...new Map([defaultRoute, imageRoute].map(route => [JSON.stringify(route), route])).values()];
    const models = (await Promise.all(routes.map(route => modelDirectory(this.ctx, actor, route, signal, true)))).flatMap(result => result.models);
    signal.throwIfAborted();
    const names = this.names();
    const rows = ids.map(id => {
      const role = current.agents.find(value => value.id === id);
      if (!role) throw new Error('Unknown or invalid agent: ' + id);
      const browser = role.capabilities.some(value => value.startsWith('browser-'));
      const route = browser ? imageRoute : defaultRoute;
      const external = current.layers.find(layer => { if (layer.source.startsWith('user:')) return false; try { return parseOverrideText(layer.text).id === id; } catch { return false; } });
      const view = this.roleView(role, names);
      return recommendRole(role, this.store.getOverride(id), models.find(model => model.provider === route.provider && model.id === route.model), {
        externalSource: external?.source, includeBrowser: request.includeBrowser !== false, parent: delegationSelection(actor),
        capabilitiesMissing: view.missingCapabilities.length > 0 || view.unverifiedCapabilities.length > 0,
      });
    });
    const applicable = rows.filter(row => row.applicable);
    if (applicable.length) {
      const preview = await this.previewSetup({ rows: applicable.map(row => ({ id: row.id, text: row.proposedText, roleRevision: row.roleRevision, expectedRevision: row.expectedRevision })) }, actor);
      for (const row of applicable) row.after = preview.resources[row.id];
    }
    const diagnostics = models.filter(model => !model.metadataResolved && model.error).map(model => ({ code: 'setup.metadataFailed',
      params: { provider: model.provider, model: model.id }, message: `Could not read metadata for ${model.provider}/${model.id}.`, original: model.error }));
    return { rows, models, diagnostics };
  }
  private setupPolicy(value: unknown): { scopePolicy: 'fill-unconfigured' | 'replace-selected' } {
    const policy = object(value, 'setupPolicy');
    if (Object.keys(policy).some(key => key !== 'scopePolicy') || !['fill-unconfigured', 'replace-selected'].includes(policy.scopePolicy)) throw new Error('Unknown setup scope policy.');
    return { scopePolicy: policy.scopePolicy };
  }
  private async recommendStrategy(request: JsonObject, actor: RuntimeAgent | undefined, signal: AbortSignal): Promise<JsonObject> {
    if (request.defaultRoute !== undefined || request.imageRoute !== undefined) throw new Error('Do not mix legacy routes with a setup strategy.');
    const ids = setupRoleIds(request.roleIds);
    const strategy = normalizeSetupStrategy(request.strategy);
    const policy = this.setupPolicy({ scopePolicy: request.scopePolicy ?? 'fill-unconfigured' });
    if (request.includeBrowser !== undefined && typeof request.includeBrowser !== 'boolean') throw new Error('includeBrowser must be boolean.');
    const current = await this.resolved(actor);
    if (current.blockers.length) throw new Error('Resolve unreadable role sources before generating settings.');
    const roles = ids.map(id => { const role = current.agents.find(value => value.id === id); if (!role) throw new Error('Unknown or invalid agent: ' + id); return role; });
    const isBrowser = (role: AgentDefinition) => role.capabilities.some(value => value.startsWith('browser-'));
    const browserRelevant = request.includeBrowser !== false && roles.some(isBrowser);
    // Inactive browser input cannot cause metadata fanout or block an unrelated role.
    const browserStrategy = browserRelevant && request.browserStrategy !== undefined ? normalizeSetupStrategy(request.browserStrategy) : strategy;
    const strategies = roles.filter(role => !isBrowser(role) || browserRelevant).map(role => isBrowser(role) ? browserStrategy : strategy);
    const parent = delegationSelection(actor);
    const routes = strategies.flatMap(value => setupStrategyRoutes(value));
    if (strategies.some(value => value.mode === 'inherit') && parent?.provider && parent.model) routes.push({ provider: parent.provider, model: parent.model });
    const uniqueRoutes = [...new Map(routes.map(route => [JSON.stringify(route), route])).values()];
    const models: JsonObject[] = (await Promise.all(uniqueRoutes.map(route => modelDirectory(this.ctx, actor, route, signal, true)))).flatMap(result => result.models);
    signal.throwIfAborted();
    const migrations = request.resourceMigration === undefined ? {} : object(request.resourceMigration, 'resourceMigration');
    if (Object.keys(migrations).some(id => !ids.includes(id))) throw new Error('Resource migration must name a selected role.');
    const names = this.names();
    const rows = roles.map(role => {
      const external = current.layers.find(layer => { if (layer.source.startsWith('user:')) return false; try { return parseOverrideText(layer.text).id === role.id; } catch { return false; } });
      const view = this.roleView(role, names);
      return recommendStrategyRole(role, this.store.getOverride(role.id), isBrowser(role) ? browserStrategy : strategy, models, {
        ...policy, resourceMigration: migrations[role.id], externalSource: external?.source, includeBrowser: request.includeBrowser !== false, parent,
        capabilitiesMissing: view.missingCapabilities.length > 0 || view.unverifiedCapabilities.length > 0,
      });
    });
    // Return independent rows first. One invalid combination must not destroy valid suggestions.
    const diagnostics = models.filter(model => !model.metadataResolved && model.error).map(model => ({ code: 'setup.metadataFailed', params: { provider: model.provider, model: model.id }, message:             'Could not read metadata for ' + model.provider + '/' + model.id + '.', original: model.error }));
    return { rows, models, diagnostics, setupPolicy: policy };
  }
  private async prepareSetup(request: JsonObject, actor?: RuntimeAgent) {
    const policy = request.setupPolicy === undefined ? undefined : this.setupPolicy(request.setupPolicy);
    if (!policy && (request.impactRevision !== undefined || request.acceptedIndirectRoles !== undefined)) throw new Error('Impact acceptance requires a setup policy.');
    const ids = setupRoleIds(Array.isArray(request.rows) ? request.rows.map(row => object(row).id) : undefined);
    const rows = (request.rows as unknown[]).map((value, index) => {
      const row = object(value); const text = requiredString(row.text, 'text', 1024 * 1024);
      if (parseOverrideText(text).id !== ids[index]) throw new Error('Submitted id must match the YAML role id.');
      return { id: ids[index], text, roleRevision: requiredString(row.roleRevision, 'roleRevision', 256), expectedRevision: optionalString(row.expectedRevision, 'expectedRevision') };
    });
    const initial = await this.resolved(actor);
    if (initial.blockers.length) throw new Error('Resolve unreadable role sources before saving.');
    const original = new Map(initial.agents.map(role => [role.id, role]));
    for (const row of rows) {
      if (policy?.scopePolicy === 'fill-unconfigured' && (this.store.getOverride(row.id) || original.get(row.id)?.enabled === false)) throw new Error('Existing or disabled settings are protected. Explicitly choose replacement and regenerate.');
      if (!original.has(row.id) || agentRevision(original.get(row.id)!) !== row.roleRevision || this.store.getOverride(row.id)?.revision !== row.expectedRevision) throw new Error('Agent configuration changed. Regenerate suggestions before applying.');
      if (initial.layers.some(layer => { if (layer.source.startsWith('user:')) return false; try { return parseOverrideText(layer.text).id === row.id; } catch { return false; } })) throw new Error('This agent is owned by a source file. Edit that file instead.');
    }
    const depth = (id: string, seen = new Set<string>()): number => { if (seen.has(id)) return 0; seen.add(id); const parent = original.get(id)?.extends; return parent ? 1 + depth(parent, seen) : 0; };
    rows.sort((a, b) => depth(a.id) - depth(b.id) || a.id.localeCompare(b.id));
    const fingerprint = (catalog: typeof initial) => digest({ roles: catalog.agents.map(role => [role.id, agentRevision(role)]).sort(), layers: catalog.layers.map(layer => [layer.source, layer.text, layer.failure]).sort() });
    const expected = [fingerprint(initial)];
    const user = new Map(initial.layers.filter(layer => layer.source.startsWith('user:')).map(layer => [layer.source, layer]));
    const files = initial.layers.filter(layer => !layer.source.startsWith('user:'));
    const baselineIssues = new Set(initial.diagnostics.map(issue => JSON.stringify(issue)));
    let proposed = initial;
    const selected = new Set(rows.map(row => row.id));
    const impacts = new Map<string, JsonObject>();
    for (const row of rows) {
      user.set('user:' + row.id, { source: 'user:' + row.id, text: row.text });
      const layers = [...[...user.values()].sort((a, b) => a.source.localeCompare(b.source)), ...files];
      const next = resolveCatalog(layers);
      const issues = next.diagnostics.filter(issue => !baselineIssues.has(JSON.stringify(issue)));
      if (issues.length || initial.agents.some(role => !next.agents.some(value => value.id === role.id))) throw new Error(issues.map(issue => issue.message).join('\n') || 'The selection invalidates a derived agent.');
      for (const role of next.agents) {
        const before = original.get(role.id);
        if (!selected.has(role.id) && (!before || digest(setupResources(before)) !== digest(setupResources(role)))) {
          const impact = impacts.get(role.id) ?? { id: role.id, title: role.title, before: before ? setupResources(before) : null, prefixes: [] };
          impact.prefixes.push({ afterId: row.id, resources: setupResources(role) });
          impacts.set(role.id, impact);
        }
      }
      proposed = { ...next, layers, blockers: [] };
      expected.push(fingerprint(proposed));
    }
    for (const impact of impacts.values()) impact.after = setupResources(proposed.agents.find(role => role.id === impact.id)!);
    const impactList = [...impacts.values()].sort((a, b) => a.id.localeCompare(b.id));
    const impactRevision = digest({ rows, expected, policy, actor: actor?.id, impacts: impactList });
    return { rows, expected, fingerprint, proposed, policy, impacts: impactList, impactRevision };
  }
  async previewSetup(request: JsonObject, actor?: RuntimeAgent): Promise<JsonObject> {
    const { proposed, impacts, impactRevision } = await this.prepareSetup(request, actor);
    return { resources: Object.fromEntries(proposed.agents.map(role => [role.id, setupResources(role)])), impacts, impactRevision };
  }
  async applySetup(request: JsonObject, actor?: RuntimeAgent): Promise<JsonObject> {
    const { rows, expected, fingerprint, policy, impacts, impactRevision } = await this.prepareSetup(request, actor);
    if (policy) {
      if (request.impactRevision !== impactRevision) throw new Error('Setup impact preview changed or is missing. Preview the exact selection again.');
      const accepted = request.acceptedIndirectRoles ?? [];
      if (!Array.isArray(accepted) || accepted.some(id => typeof id !== 'string') || new Set(accepted).size !== accepted.length || accepted.some(id => !impacts.some(impact => impact.id === id))) throw new Error('Indirect role acceptance must match the current impact preview.');
      if (impacts.some(impact => !accepted.includes(impact.id))) throw new Error('Confirm every indirect role impact, including intermediate saved prefixes, before applying.');
    }
    return this.store.saveBatch(rows, async index => {
      if (fingerprint(await this.resolved(actor)) !== expected[index]) throw new Error('Agent configuration changed. Refresh and regenerate suggestions before continuing.');
    });
  }
  private assertNarrower(before: AgentDefinition | undefined, next: AgentDefinition | undefined): void {
    if (!before || !next || next.capabilities.some(capability => !before.capabilities.includes(capability)) || next.scripts.some(script => !before.scripts.includes(script)) || (next.enabled && !before.enabled)) throw new Error('This change creates, enables or expands capability; use the user management page.');
    const resources = (role: AgentDefinition) => ({ model: role.model, reasoning: role.reasoning, output: role.output, context: role.context });
    if (digest(resources(before)) !== digest(resources(next))) throw new Error('Model candidates, routes, reasoning, output and input resource policies are owner-managed; use the user management page.');
  }
  async save(request: JsonObject, actor?: RuntimeAgent, narrowOnly = false): Promise<JsonObject> {
    const id = requiredString(request.id, 'id', 64);
    const text = requiredString(request.text, 'text', 1024 * 1024);
    const parsed = parseOverrideText(text);
    if (parsed.id !== id) throw new Error('Submitted id must match the YAML role id.');
    return this.store.save(id, text, optionalString(request.expectedRevision, 'expectedRevision'), async () => {
      const current = await this.resolved(actor);
      if (current.blockers.length) throw new Error('Resolve unreadable role sources before saving.');
      const fileInputs = current.layers.filter(layer => !layer.source.startsWith('user:'));
      const externalOwner = fileInputs.find(layer => {
        try { return parseOverrideText(layer.text).id === id; } catch { return false; }
      });
      if (externalOwner) throw new Error(`This role is owned by ${externalOwner.source}. Edit that file or derive a new role id; a user override would be hidden by that source.`);
      const inputs = this.store.overrides().filter(value => value.id !== id).map(value => ({ source: `user:${value.id}`, text: value.text }));
      const candidate = resolveCatalog([...inputs, { source: `user:${id}`, text }, ...fileInputs]);
      const issues = candidate.diagnostics.filter(issue => issue.id === id || issue.source === `user:${id}`);
      const next = candidate.agents.find(role => role.id === id);
      if (issues.length || !next) throw new Error(issues.map(issue => issue.message).join('\n') || 'Invalid role definition.');
      if (narrowOnly) this.assertNarrower(current.agents.find(role => role.id === id), next);
    });
  }
  async reset(request: JsonObject, actor?: RuntimeAgent, narrowOnly = false): Promise<JsonObject> {
    const id = requiredString(request.id, 'id', 64);
    await this.store.reset(id, requiredString(request.expectedRevision, 'expectedRevision'), async () => {
      if (!narrowOnly) return;
      const current = await this.resolved(actor);
      const next = resolveCatalog(current.layers.filter(layer => layer.source !== `user:${id}`));
      this.assertNarrower(current.agents.find(role => role.id === id), next.agents.find(role => role.id === id));
    });
    return { id, reset: true };
  }
  async start(request: JsonObject, exec: ToolRunContext): Promise<JsonObject> {
    if (!exec.agent) throw new Error('Scene delegation requires the actual calling Agent.');
    const parent = exec.agent as RuntimeAgent;
    const runId = digest([parent.id, exec.callId]).slice(0, 32);
    let pending = this.starts.get(runId);
    if (pending) return pending;
    const previous = this.store.getRun(runId);
    const existing = previous ? await this.reconcile(previous, exec.signal) : undefined;
    if (existing?.childId) return { ...existing, reused: true };
    if (existing) throw new Error(`Previous startup ${runId} is ${existing.phase}. Native catalog reconciliation found no proven accepted child; no duplicate task was started.`);
    pending = this.startOnce(runId, request, exec, parent);
    this.starts.set(runId, pending);
    try { return await pending; } finally { this.starts.delete(runId); }
  }
  private async startOnce(runId: string, request: JsonObject, exec: ToolRunContext, parent: RuntimeAgent): Promise<JsonObject> {
    const roleId = optionalString(request.role, 'role') ?? 'general';
    const role = await this.role(roleId, parent);
    const prompt = requiredString(request.prompt, 'prompt');
    const description = optionalString(request.description, 'description') ?? `${role.title.zh} / ${role.title.en}`;
    const selection = await this.selection(role, parent, request, exec.signal, true);
    const budget = admissionBudget({ ...role.context, windowTokens: selection.metadata.context?.contextWindow, outputTokens: selection.effective.maxTokens ?? selection.metadata.defaultMaxTokens });
    const fixedEstimate = Math.ceil((role.instructions.length + prompt.length) / 3);
    if (budget.known && (budget.safeInputTokens ?? 0) <= fixedEstimate) throw new Error('Mandatory task input exceeds the selected model safe input space. Pass source references or smaller chunks before delegating.');
    const builtins = new Map(loadBuiltinSkills().map(skill => [skill.id, skill]));
    const skills: RoleSnapshot['skills'] = [];
    for (const id of role.skills) {
      const builtin = builtins.get(id);
      if (builtin) { skills.push(builtin); continue; }
      const registry = this.ctx.get('skills' as any) as any;
      const loaded = await registry?.get(id, { scope: parent, cwd: this.cwd(parent), signal: exec.signal });
      if (!loaded) throw new Error(`Required role skill is unavailable: ${id}. No child has been started.`);
      if (typeof loaded.content !== 'string' || loaded.content.length > 24_000) throw new Error(`Skill ${id} is not a complete bounded instruction resource.`);
      skills.push({ id, description: loaded.description ?? id, body: loaded.content, ...(loaded.resourceBase ? { resourceBase: jsonClone(loaded.resourceBase) } : {}) });
    }
    const scriptRevisions: Record<string, string> = {};
    for (const path of role.scripts) {
      if (!path.startsWith('assets/scripts/') || path.includes('..')) throw new Error(`Script must be a declared package resource: ${path}`);
      const base = await realpath(fileURLToPath(new URL('../../assets/scripts/', import.meta.url)));
      const target = await realpath(fileURLToPath(new URL(`../../${path}`, import.meta.url)));
      const inside = relative(base, target);
      if (inside.startsWith('..') || isAbsolute(inside)) throw new Error(`Script resource resolves outside the packaged scripts directory: ${path}`);
      scriptRevisions[path] = textRevision(await readFile(target, 'utf8'));
    }
    const webTools = role.capabilities.includes('web-research') && !!this.ctx.get('web' as any);
    const sourceRevision = agentRevision(role);
    const decision = selection.choice.decision;
    const identity = digest({ role: sourceRevision, ...(decision ? { candidateId: decision.candidateId } : {}), skills, model: selection.effective, budget, scriptRevisions, webTools, policyVersion: 1 });
    // Only the selected route reaches the immutable child snapshot, never the candidate pool.
    const pinnedRole: AgentDefinition = role.model.mode === 'auto' ? { ...role, model: { mode: 'fixed', provider: selection.effective.provider, model: selection.effective.model },
      reasoning: selection.effective.reasoningEffort ? { mode: 'fixed', effort: selection.effective.reasoningEffort } : { mode: 'model-default' }, output: { maxTokens: selection.effective.maxTokens! } } : role;
    let snapshot: RoleSnapshot = { id: identity, presetId: `agentdeck-${role.id}-${identity.slice(0, 16)}`, role: jsonClone(pinnedRole), sourceRevision, ...(decision ? { candidateId: decision.candidateId } : {}), skills: jsonClone(skills), model: { ...selection.effective, ...(selection.metadata.context?.contextWindow ? { contextWindow: selection.metadata.context.contextWindow } : {}) }, budget, scriptRevisions, webTools, createdAt: Date.now(), policyVersion: 1 };
    await this.store.snapshot(snapshot);
    let presetId: string | undefined = snapshot.presetId;
    let fallback: RunRecord['fallback'];
    try { await this.presets.register(snapshot); await this.presets.verify(snapshot.presetId); }
    catch (error) {
      const factoryGeneral = loadBuiltinAgents().find(value => value.id === 'general')!;
      const mayUseNative = this.config.allowNativeFallback === true && role.id === 'general' && agentRevision(role) === agentRevision(factoryGeneral);
      if (!mayUseNative) throw error;
      // A minimal independent native preset retains the SAME role policy, skills,
      // model and isolated compaction. It never inherits an unrestricted parent.
      const fallbackId = digest({ revision: snapshot.id, composition: 'native-minimal' });
      snapshot = { ...snapshot, id: fallbackId, presetId: `agentdeck-general-${fallbackId.slice(0, 16)}-native`, composition: 'native-minimal' };
      await this.store.snapshot(snapshot);
      await this.presets.register(snapshot);
      await this.presets.verify(snapshot.presetId);
      presetId = snapshot.presetId;
      fallback = { to: 'native', reason: `General tool composition unavailable before startup: ${messageOf(error)}. A guarded native preset retains the same permissions and budgets; optional file-tool availability may be reduced.` };
    }
    const run: RunRecord = { id: runId, roleId, revision: snapshot.id, parentId: parent.id, description, createdAt: Date.now(), phase: 'starting', model: selection.effective, ...(decision ? { decision } : {}), ...(fallback ? { fallback } : {}) };
    await this.store.run(run);
    try {
      const childId = await this.native.invoke(presetId, {
        description: `AgentDeck ${runId}: ${description}`,
        prompt: `AgentDeck task ${runId}. Role ${role.id}, revision ${snapshot.id}.\n\n${prompt}\n\nPreserve the authorized task scope. Report evidence, coverage, limitations and unfinished work; never claim a missing check passed.`,
        ...selection.nativeFields,
        ...(request.cwd !== undefined ? { cwd: requiredString(request.cwd, 'cwd') } : {}),
      }, exec, snapshot);
      const accepted: RunRecord = { ...run, childId, phase: 'accepted' };
      await this.store.run(accepted);
      return { ...accepted, budget, status: 'started', completion: 'The native runtime will notify the parent; read details only when needed.' };
    } catch (error) {
      const failed: RunRecord = { ...run, phase: error instanceof NativeDelegationFailure && error.beforeDispatch ? 'failed' : 'uncertain', error: messageOf(error) };
      await this.store.run(failed);
      throw new Error(`${failed.error}\nStartup receipt ${runId}: ${failed.phase}. Do not automatically re-run the full task or route around a policy refusal.`);
    }
  }
  private runForChild(childId: string, actor?: RuntimeAgent): RunRecord {
    const run = this.store.runs().find(value => value.childId === childId);
    if (!run) throw new Error('This is not an AgentDeck child task. Use its native control surface.');
    if (actor && run.parentId !== actor.id) throw new Error('Only the exact direct parent may control this AgentDeck task.');
    return run;
  }
  async control(request: JsonObject, actor: RuntimeAgent, signal: AbortSignal): Promise<JsonObject> {
    const childId = requiredString(request.childId, 'childId');
    const run = this.runForChild(childId, actor);
    const action = requiredString(request.action, 'action');
    if (action === 'status') return this.result({ childId }, actor, signal);
    if (action === 'continue') {
      const snapshot = this.store.snapshots().find(value => value.id === run.revision);
      if (!snapshot) throw new Error('This task is missing its immutable snapshot; do not reroute or restart it.');
      await this.presets.verify(snapshot.presetId);
      signal.throwIfAborted();
      const content = requiredString(request.message, 'message');
      const messageId = await this.ctx.subagents.sendMessage(actor, childId as any, [{ type: 'text', text: content }], { signal });
      return { childId, accepted: true, messageId };
    }
    if (action === 'interrupt') {
      this.ctx.subagents.interrupt(childId as any, { kind: 'ancestor', agent: actor });
      return { childId, interrupted: true, note: 'Current-turn stop requested; this is not a completed-task claim.' };
    }
    if (action === 'release') throw new Error('Release by child id is unavailable in DSH 0.2.2-rc.3. Native execution owns the activation; use interrupt to stop current work without closing the parent or Team tree.');
    throw new Error('Unknown control action; choose status, continue or interrupt.');
  }
  async result(request: JsonObject, actor?: RuntimeAgent, signal = new AbortController().signal): Promise<JsonObject> {
    const childId = requiredString(request.childId, 'childId');
    const run = this.runForChild(childId, actor);
    const snapshot = this.store.snapshots().find(value => value.id === run.revision);
    const diagnostics = snapshot ? await this.presets.audit([snapshot.presetId], signal) : ['This task is missing its immutable role snapshot.'];
    signal.throwIfAborted();
    return { ...await readRunResult(this.ctx, run, request.offset ?? 0, request.limit ?? 12_000), diagnostics };
  }
  private async reconcile(run: RunRecord, signal?: AbortSignal): Promise<RunRecord> {
    if (run.childId || run.phase === 'failed' || this.starts.has(run.id)) return run;
    using observation = await this.ctx.sessionQuery.observeSession(run.parentId as any, { signal });
    const catalog = observation.projections?.values.subagentCatalog as readonly SubagentCatalogEntry[] | undefined;
    if (!catalog) throw new Error('Native direct-child catalog projection is unavailable; startup remains uncertain and will not be repeated.');
    const candidates = catalog.filter(entry => entry.mode === 'continuable' && entry.label?.startsWith(`AgentDeck ${run.id}: `));
    if (!candidates.length) return run;
    if (candidates.length !== 1) throw new Error(`Startup ${run.id} has multiple native catalog matches; inspect them without restarting the task.`);
    const snapshot = this.store.snapshots().find(value => value.id === run.revision);
    if (!snapshot) throw new Error(`Startup ${run.id} is missing its role snapshot.`);
    const child = await this.ctx.sessionQuery.readSession(candidates[0].id);
    if (child.session.parentSession !== run.parentId || child.session.agentPreset !== snapshot.presetId) throw new Error(`Startup ${run.id} does not match the child's native parent/preset metadata.`);
    const repaired: RunRecord = { ...run, childId: candidates[0].id, phase: 'accepted' };
    delete repaired.error;
    await this.store.run(repaired);
    return repaired;
  }
  async runs(actor?: RuntimeAgent, signal?: AbortSignal): Promise<JsonObject> {
    const runs = [];
    for (const saved of this.store.runs().filter(run => !actor || run.parentId === actor.id).slice(0, 200)) {
      let run = saved;
      try { run = await this.reconcile(saved, signal); }
      catch (error) { signal?.throwIfAborted(); run = { ...saved, error: `${saved.error ?? ''} Reconciliation: ${messageOf(error)}`.trim() }; }
      runs.push({ ...run, ...(run.childId ? { nativeStatus: this.ctx.agents.get(run.childId as any)?.status ?? 'not-resident' } : {}) });
    }
    return { runs };
  }
  async operation(name: string, payload: unknown, actor?: RuntimeAgent, signal = new AbortController().signal): Promise<JsonObject> {
    const request = object(payload ?? {});
    switch (name) {
      case 'catalog': return this.catalog(actor, signal);
      case 'models': return this.models(actor, request, signal);
      case 'preview': return this.preview(requiredString(request.id, 'id'), actor, signal, request);
      case 'candidates': return this.candidates(requiredString(request.id, 'id'), actor, signal);
      case 'recommend': return this.recommend(request, actor, signal);
      case 'previewSetup': return this.previewSetup(request, actor);
      case 'applySetup': return this.applySetup(request, actor);
      case 'save': return this.save(request, actor);
      case 'reset': return this.reset(request, actor);
      case 'runs': return this.runs(actor, signal);
      case 'result': return this.result(request, actor, signal);
      default: throw new Error(`Unknown AgentDeck operation ${name}`);
    }
  }
  async dispose(): Promise<void> { await this.native.dispose(); await this.presets.dispose(); await this.store.close(); }
}

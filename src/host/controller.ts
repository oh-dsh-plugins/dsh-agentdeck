import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBuiltinAgents, loadBuiltinSkills, parseOverrideText, agentRevision } from '../core/index.js';
import type { AgentDefinition } from '../core/index.js';
import { rolePresentation } from '../core/presentation.js';
import { setupResources, applyDefinitionActions } from './setup.js';
import { suggestRole } from './suggestions.js';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';
import type { TaskCommands, SessionQueries, ModelQueries, ModelView } from './contracts.js';
import { NativeSessionQueries } from './sessions.js';
import { AgentDeckStore, textRevision } from './store.js';
import { NativeDelegator, NativeDelegationFailure } from './native.js';
import { SnapshotPresets } from './presets.js';
import { createModelQueries, routeAuthorization, supportsTextInput, ModelAuthorizationError } from './models.js';
import { missingCapabilities } from './capabilities.js';
import { readRunResult } from './results.js';
import { roleChoice } from './selection.js';
import { inspectBrowserSupport, type BrowserEvidence } from './browser.js';
import { browserReadiness } from './browser-runtime.js';
import { object, requiredString, optionalString, messageOf, jsonClone } from './types.js';
import type { HostContext, RuntimeAgent, RoleSnapshot, RunRecord, JsonObject, EffectiveSelection } from './types.js';
import { RoleCatalogs, assertNoRoleLoss, assertReadable } from './configuration.js';

export interface AgentDeckConfig { customAgentDirs?: string[]; projectConfigDirectory?: string; allowNativeFallback?: boolean }
const textInputRequired = 'Agent roles require a model that supports text input.';
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function collectImpacts(from: Map<string, AgentDefinition>, to: AgentDefinition[], target: Map<string, JsonObject>, afterId: string,
  selected: ReadonlySet<string>, owners?: ReadonlyMap<string, string>, pending?: ReadonlyMap<string, JsonObject>): void {
  const byId = new Map(to.map(role => [role.id, role]));
  const inheritsFrom = (id: string): boolean => {
    const seen = new Set<string>();
    let parent = byId.get(id)?.extends;
    while (parent && !seen.has(parent)) {
      if (parent === afterId) return true;
      seen.add(parent);
      parent = byId.get(parent)?.extends;
    }
    return false;
  };
  const authors = (patch: JsonObject | undefined, resource: string): boolean => {
    if (!patch) return false;
    if (resource === 'model') {
      const model = patch.model;
      if (!model || typeof model !== 'object' || Array.isArray(model)) return false;
      const mode = (model as JsonObject).mode;
      return mode === 'fixed' ? typeof (model as JsonObject).provider === 'string' && typeof (model as JsonObject).model === 'string'
        : mode === 'auto' ? Array.isArray((model as JsonObject).candidates) && typeof (model as JsonObject).defaultCandidate === 'string' : false;
    }
    if (resource === 'reasoning') {
      const reasoning = patch.reasoning;
      if (!reasoning || typeof reasoning !== 'object' || Array.isArray(reasoning)) return false;
      return (reasoning as JsonObject).mode === 'model-default' || ((reasoning as JsonObject).mode === 'fixed' && typeof (reasoning as JsonObject).effort === 'string');
    }
    return Object.hasOwn(patch, resource);
  };
  for (const role of to) {
    const previous = from.get(role.id);
    const before = previous ? setupResources(previous) : null;
    const resources = setupResources(role);
    const changed = before ? (['model', 'reasoning'] as const).filter(key => digest([before[key]]) !== digest([resources[key]])) : [];
    // A project-owned definition can share the ID without being edited by the batch.
    // A selected row that explicitly authors every changed resource owns its direct result.
    const selectedDirect = selected.has(role.id) && !owners?.has(role.id);
    const directRowOwnsChange = changed.length > 0 && changed.every(key => authors(pending?.get(role.id), key));
    if (selectedDirect && (role.id === afterId || !inheritsFrom(role.id) || role.schemaVersion === 1 || directRowOwnsChange)) continue;
    if (before && digest(before) === digest(resources)) continue;
    const impact = target.get(role.id) ?? { id: role.id, title: role.title, before, prefixes: [] };
    impact.prefixes.push({ afterId, resources });
    target.set(role.id, impact);
  }
}

export class ChangeImpactError extends Error {
  constructor(readonly code: 'AGENTDECK_IMPACT_PREVIEW_REQUIRED' | 'AGENTDECK_IMPACT_PREVIEW_CHANGED' | 'AGENTDECK_IMPACT_CONSENT_REQUIRED', message: string) {
    super(message);
  }
}

export class AgentDeckController {
  private readonly configuration: RoleCatalogs;
  private readonly native: TaskCommands;
  private readonly sessions: SessionQueries;
  private readonly modelQueries: ModelQueries;
  private readonly presets: SnapshotPresets;
  private readonly starts = new Map<string, Promise<JsonObject>>();
  private readonly builtinIds = new Set(loadBuiltinAgents().map(role => role.id));
  readonly diagnostics: string[] = [];
  constructor(readonly ctx: HostContext, readonly store: AgentDeckStore, readonly config: AgentDeckConfig = {}, ports?: { tasks: TaskCommands; sessions: SessionQueries; models: ModelQueries }) {
    this.configuration = new RoleCatalogs(ctx, () => store.overrides(), config.customAgentDirs ?? [], config.projectConfigDirectory ?? '.dsh/agentdeck');
    this.native = ports?.tasks ?? new NativeDelegator(ctx);
    this.sessions = ports?.sessions ?? new NativeSessionQueries(ctx);
    this.modelQueries = ports?.models ?? createModelQueries(ctx);
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
    return this.sessions.agent(sessionId);
  }
  private cwd(agent?: RuntimeAgent): string | undefined {
    return this.configuration.cwd(agent);
  }
  private resolved(agent?: RuntimeAgent) { return this.configuration.read(agent); }
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
    const parent = this.modelQueries.inheritance(agent);
    const routes = await this.modelQueries.policy(agent, signal);
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
      runtime: this.sessions.diagnostics(),
      sessions: this.sessions.roots().map(item => ({ id: item.id, cwd: this.cwd(item) })),
    };
  }
  async models(agent?: RuntimeAgent, request: JsonObject = {}, signal?: AbortSignal): Promise<JsonObject> {
    const provider = optionalString(request.provider, 'provider');
    const model = optionalString(request.model, 'model');
    if (model !== undefined && provider === undefined) throw new Error('A model metadata query requires its provider.');
    if (request.view === 'setup-options') {
      if (model !== undefined) throw new Error('Setup model options do not resolve exact model metadata.');
      return this.modelQueries.directory(undefined, provider ? { provider } : undefined, signal, true);
    }
    if (request.view !== undefined && request.view !== 'options') throw new Error('Unknown model directory view.');
    const result = await this.modelQueries.directory(agent, provider ? { provider, ...(model ? { model } : {}) } : undefined, signal, request.view === 'options');
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
    const routes = await this.modelQueries.policy(agent, signal);
    signal?.throwIfAborted();
    return routeAuthorization(configured, this.modelQueries.inheritance(agent), routes, !!agent, explicit);
  }
  private async resolveConfig(configured: EffectiveSelection, signal?: AbortSignal, parent?: JsonObject): Promise<EffectiveSelection> {
    return this.modelQueries.resolve(configured, signal, parent);
  }
  private async selection(role: AgentDefinition, agent: RuntimeAgent, request: JsonObject, signal?: AbortSignal, requireRevision = false) {
    const parent = this.modelQueries.inheritance(agent);
    if (!parent) throw new Error('The calling Session has no effective model. Configure a native model before delegating.');
    const choice = roleChoice(role, parent, request, requireRevision);
    const configured = choice.configured!;
    const authorization = await this.authorization(configured, agent, choice.explicit, signal);
    if (authorization.status !== 'authorized') throw new ModelAuthorizationError(authorization);
    const effective = await this.resolveConfig(configured, signal, parent);
    const metadata = await this.modelQueries.info(configured.provider, configured.model, signal);
    if (!supportsTextInput(metadata)) throw new Error(textInputRequired);
    const nativeFields = choice.explicit ? { provider: configured.provider, model: configured.model, ...(effective.reasoningEffort ? { reasoning_effort: effective.reasoningEffort } : {}) } : {};
    return { effective, metadata, nativeFields, choice };
  }
  async candidates(id: string, agent?: RuntimeAgent, signal = new AbortController().signal): Promise<JsonObject> {
    const role = await this.role(id, agent);
    signal.throwIfAborted();
    const routes = agent ? await this.modelQueries.policy(agent, signal) : undefined;
    const parent = this.modelQueries.inheritance(agent);
    return { id: role.id, revision: agentRevision(role), mode: role.model.mode, defaultCandidate: role.model.defaultCandidate,
      candidates: (role.model.candidates ?? []).map(candidate => ({ id: candidate.id, purpose: candidate.purpose, provider: candidate.provider, model: candidate.model,
        reasoning: candidate.reasoning,
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
    try { choice = roleChoice(role, this.modelQueries.inheritance(agent), request); }
    catch (error) { const authorization = { status: 'unknown' }; return { agent: { ...view, capabilitiesAvailable: view.available, available: false, authorization }, authorization, recovery: { policy: 'native' }, diagnostics: [messageOf(error)] }; }
    const configured = choice.configured;
    let metadata: ModelView | undefined;
    let effective: EffectiveSelection | undefined;
    const authorization = await this.authorization(configured, agent, choice.explicit, signal);
    if (configured) {
      try { metadata = await this.modelQueries.info(configured.provider, configured.model, signal); }
      catch (error) { signal.throwIfAborted(); diagnostics.push(`Model declaration: ${messageOf(error)}`); }
      if (agent) {
        if (authorization.status !== 'authorized') {
          if (authorization.message) diagnostics.push(authorization.message);
        } else {
          try { effective = await this.resolveConfig(configured, signal, this.modelQueries.inheritance(agent)); }
          catch (error) { signal.throwIfAborted(); diagnostics.push(`Native parameter validation: ${messageOf(error)}`); }
        }
      } else diagnostics.push('Select a live Session to validate authorization and effective output parameters. Model declarations and configured capacity are not task admission.');
    } else diagnostics.push('Select a live Session to resolve inherited model parameters.');
    const agentView = this.selectionView(view, choice, authorization);
    if (metadata && !supportsTextInput(metadata)) {
      diagnostics.push(textInputRequired);
      agentView.available = false;
    }
    return { agent: agentView, ...(metadata ? { model: { ...metadata, authorized: agent ? authorization.status === 'authorized' : null } } : {}),
      ...(configured ? { configuredSelection: configured } : {}), ...(effective ? { effectiveSelection: effective } : {}), sessionSelection: this.modelQueries.selection(agent),
      authorization,
      recovery: { policy: 'native', contextWindow: metadata?.contextWindow }, diagnostics };
  }
  private setupExternalSources(layers: { source: string; text: string }[]): Map<string, string> {
    const sources = new Map<string, string>();
    for (const layer of layers) {
      if (layer.source.startsWith('user:')) continue;
      try {
        const { id } = parseOverrideText(layer.text);
        if (typeof id === 'string' && !sources.has(id)) sources.set(id, layer.source);
      } catch { /* Invalid layers are already reported by catalog diagnostics. */ }
    }
    return sources;
  }
  async suggest(request: JsonObject, actor?: RuntimeAgent, signal = new AbortController().signal): Promise<JsonObject> {
    const current = await this.resolved(actor);
    signal.throwIfAborted();
    const saved = current.agents.find(role => role.id === request.id);
    if (request.revision !== undefined && (!saved || agentRevision(saved) !== request.revision)) throw new Error('The role changed while editing. Reload before generating a suggestion.');
    const result = await suggestRole(this.ctx, request, signal);
    if (saved) {
      const after = await this.resolved(actor);
      if (after.blockers.length) throw new Error(`Role source cannot be read safely: ${after.blockers.map(value => `${value.source}: ${value.message}`).join('; ')}`);
      const currentRole = after.agents.find(role => role.id === saved.id);
      if (!currentRole || agentRevision(currentRole) !== agentRevision(saved)) throw new Error('The role changed during generation. Generate a fresh suggestion.');
    }
    return result;
  }
  private async prepareChange(request: JsonObject, actor?: RuntimeAgent, signal?: AbortSignal): Promise<JsonObject> {
    const id = requiredString(request.id, 'id', 64);
    const reset = request.reset === true;
    const expectedRevision = optionalString(request.expectedRevision, 'expectedRevision');
    const state = await this.configuration.forWrite(actor, signal);
    const baseline = state.catalogs();
    assertReadable(baseline);
    const current = baseline.current;
    const stored = this.store.getOverride(id);
    const role = current.agents.find(agent => agent.id === id) ?? baseline.global.agents.find(agent => agent.id === id);
    const actions = request.actions;
    if (actions !== undefined && (!role || !Array.isArray(actions) || request.text !== undefined || reset)) throw new Error('Definition actions require an existing role, without raw text or reset.');
    const text = reset ? undefined : Array.isArray(actions)
      ? applyDefinitionActions(request.baseText === undefined ? stored?.text : requiredString(request.baseText, 'baseText', 1024 * 1024), role!, actions)
      : requiredString(request.text, 'text', 1024 * 1024);
    if (!reset && parseOverrideText(text!).id !== id) throw new Error('Submitted id must match the YAML role id.');
    if (reset && (!stored || stored.revision !== expectedRevision)) throw new Error('Agent configuration changed. Reload before resetting.');
    if (!reset && stored && stored.revision !== expectedRevision) throw new Error('Agent configuration changed. Reload it before saving; your draft has not been applied.');
    if (!reset && !stored && expectedRevision) throw new Error('Agent override no longer exists. Reload before saving.');
    const externalOwner = this.setupExternalSources(current.layers).get(id);
    if (!reset && externalOwner) throw new Error(`This role is owned by ${externalOwner}. Edit that file or derive a new role id; a user override would be hidden by that source.`);
    const candidate = state.withWrite(id, text).catalogs();
    const issues = candidate.current.diagnostics.filter(issue => issue.id === id || issue.source === `user:${id}`);
    if (!reset && (issues.length || !candidate.current.agents.some(role => role.id === id))) {
      throw new Error(issues.map(issue => issue.message).join('\n') || 'Invalid role definition.');
    }
    assertNoRoleLoss(baseline, candidate, reset ? id : undefined);
    const roleMap = (roles: AgentDefinition[]) => new Map(roles.map(role => [role.id, role]));
    const impacts = new Map<string, JsonObject>();
    const globalImpacts = new Map<string, JsonObject>();
    const globalOriginal = roleMap(baseline.global.agents);
    const otherProjects = [...baseline.projects].filter(([cwd]) => cwd !== state.currentProject)
      .map(([cwd, catalog]) => ({ cwd, before: roleMap(catalog.agents), owners: this.setupExternalSources(catalog.layers), impacts: new Map<string, JsonObject>() }));

    const selected = new Set([id]);
    if (baseline.current !== baseline.global) collectImpacts(globalOriginal, candidate.global.agents, globalImpacts, id, selected);
    collectImpacts(roleMap(current.agents), candidate.current.agents, impacts, id, selected);
    for (const project of otherProjects) collectImpacts(project.before, candidate.projects.get(project.cwd)!.agents, project.impacts, id, selected, project.owners);
    const finish = (target: Map<string, JsonObject>, roles: AgentDefinition[]) => {
      const final = new Map(roles.map(role => [role.id, role]));
      for (const impact of target.values()) impact.after = final.has(impact.id) ? setupResources(final.get(impact.id)!) : null;
    };
    finish(impacts, candidate.current.agents);
    if (baseline.current === baseline.global) for (const impact of impacts.values()) impact.scope = 'global';
    finish(globalImpacts, candidate.global.agents);
    for (const [impactId, impact] of globalImpacts) {
      const project = impacts.get(impactId);
      if (!project) impacts.set(impactId, { ...impact, scope: 'global' });
      else if (digest([project.before, project.after, project.prefixes]) !== digest([impact.before, impact.after, impact.prefixes])) project.global = { before: impact.before, after: impact.after, prefixes: impact.prefixes };
    }
    const impactKey = (impact: JsonObject) => digest([impact.before, impact.after, impact.prefixes]);
    for (const project of otherProjects) {
      finish(project.impacts, candidate.projects.get(project.cwd)!.agents);
      for (const [impactId, impact] of project.impacts) {
        const global = baseline.current === baseline.global ? impacts.get(impactId) : globalImpacts.get(impactId);
        if (global && global.scope !== 'projects' && impactKey(global) === impactKey(impact)) continue;
        const entry = impacts.get(impactId) ?? { ...impact, scope: 'projects' };
        (entry.projects ??= []).push({ cwd: project.cwd, before: impact.before, after: impact.after, prefixes: impact.prefixes });
        impacts.set(impactId, entry);
      }
    }
    const impactList = [...impacts.values()].sort((a, b) => a.id.localeCompare(b.id));
    const configRevision = state.fingerprint();
    const impactRevision = digest({ operation: reset ? 'reset' : 'save', id, text, expectedRevision, configRevision, actor: actor?.id, impacts: impactList });
    const after = candidate.current.agents.find(agent => agent.id === id);
    return { id, ...(text === undefined ? { reset: true } : { text }), ...(expectedRevision ? { expectedRevision } : {}),
      direct: { before: role ?? null, after: after ?? null }, diagnostics: issues,
      currentText: stored?.text ?? null, impacts: impactList, impactRevision, configRevision };
  }
  private acceptChange(request: JsonObject, prepared: JsonObject, requirePreview = false, label = 'Change'): void {
    const revision = optionalString(request.impactRevision, 'impactRevision');
    const accepted = request.acceptedIndirectRoles ?? [];
    if (revision === undefined) {
      if (requirePreview || prepared.impacts.length) throw new ChangeImpactError('AGENTDECK_IMPACT_PREVIEW_REQUIRED', `${label} impact preview is required before saving changes.`);
      return;
    }
    if (revision !== prepared.impactRevision) throw new ChangeImpactError('AGENTDECK_IMPACT_PREVIEW_CHANGED', `${label} impact preview changed or is missing. Preview the exact selection again.`);
    if (!Array.isArray(accepted) || accepted.some(id => typeof id !== 'string') || new Set(accepted).size !== accepted.length || accepted.some(id => !prepared.impacts.some((impact: JsonObject) => impact.id === id)) ) throw new ChangeImpactError('AGENTDECK_IMPACT_CONSENT_REQUIRED', 'Indirect role acceptance must match the current impact preview.');
    if (prepared.impacts.some((impact: JsonObject) => !accepted.includes(impact.id))) throw new ChangeImpactError('AGENTDECK_IMPACT_CONSENT_REQUIRED', 'Confirm every indirect role impact before applying.');
  }
  async previewChange(request: JsonObject, actor?: RuntimeAgent, signal?: AbortSignal): Promise<JsonObject> {
    return this.prepareChange(request, actor, signal);
  }
  async save(request: JsonObject, actor?: RuntimeAgent, signal?: AbortSignal): Promise<JsonObject> {
    const id = requiredString(request.id, 'id', 64);
    const text = requiredString(request.text, 'text', 1024 * 1024);
    const parsed = parseOverrideText(text);
    if (parsed.id !== id) throw new Error('Submitted id must match the YAML role id.');
    return this.store.save(id, text, optionalString(request.expectedRevision, 'expectedRevision'), async () => {
      this.acceptChange(request, await this.prepareChange({ ...request, reset: false }, actor, signal));
    });
  }
  async reset(request: JsonObject, actor?: RuntimeAgent, signal?: AbortSignal): Promise<JsonObject> {
    const id = requiredString(request.id, 'id', 64);
    const expectedRevision = requiredString(request.expectedRevision, 'expectedRevision');
    await this.store.reset(id, expectedRevision, async () => {
      this.acceptChange(request, await this.prepareChange({ ...request, reset: true }, actor, signal));
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
    const identity = digest({ role: sourceRevision, ...(decision ? { candidateId: decision.candidateId } : {}), skills, model: selection.effective, scriptRevisions, webTools, policyVersion: 2 });
    // Only the selected route reaches the immutable child snapshot, never the candidate pool.
    const pinnedRole: AgentDefinition = role.model.mode === 'auto' ? { ...role, model: { mode: 'fixed', provider: selection.effective.provider, model: selection.effective.model },
      reasoning: selection.effective.reasoningEffort ? { mode: 'fixed', effort: selection.effective.reasoningEffort } : { mode: 'model-default' } } : role;
    let snapshot: RoleSnapshot = { id: identity, presetId: `agentdeck-${role.id}-${identity.slice(0, 16)}`, role: jsonClone(pinnedRole), sourceRevision, ...(decision ? { candidateId: decision.candidateId } : {}), skills: jsonClone(skills), model: { provider: selection.effective.provider, model: selection.effective.model, ...(selection.effective.reasoningEffort ? { reasoningEffort: selection.effective.reasoningEffort } : {}), ...(selection.metadata.contextWindow ? { contextWindow: selection.metadata.contextWindow } : {}) }, scriptRevisions, webTools, createdAt: Date.now(), policyVersion: 2 };
    await this.store.snapshot(snapshot);
    let presetId: string | undefined = snapshot.presetId;
    let fallback: RunRecord['fallback'];
    try { await this.presets.register(snapshot); await this.presets.verify(snapshot.presetId); }
    catch (error) {
      const factoryGeneral = loadBuiltinAgents().find(value => value.id === 'general')!;
      const mayUseNative = this.config.allowNativeFallback === true && role.id === 'general' && agentRevision(role) === agentRevision(factoryGeneral);
      if (!mayUseNative) throw error;
      // A minimal independent native preset retains the SAME role policy, skills,
      // model and native recovery. It never inherits an unrestricted parent.
      const fallbackId = digest({ revision: snapshot.id, composition: 'native-minimal' });
      snapshot = { ...snapshot, id: fallbackId, presetId: `agentdeck-general-${fallbackId.slice(0, 16)}-native`, composition: 'native-minimal' };
      await this.store.snapshot(snapshot);
      await this.presets.register(snapshot);
      await this.presets.verify(snapshot.presetId);
      presetId = snapshot.presetId;
      fallback = { to: 'native', reason: `General tool composition unavailable before startup: ${messageOf(error)}. A guarded native preset retains the same permissions and native recovery; optional file-tool availability may be reduced.` };
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
      return { ...accepted, status: 'started', completion: 'The native runtime will notify the parent; read details only when needed.' };
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
      const messageId = await this.native.send(actor, childId, content, signal);
      return { childId, accepted: true, messageId };
    }
    if (action === 'interrupt') {
      this.native.interrupt(actor, childId);
      return { childId, interrupted: true, note: 'Current-turn stop requested; this is not a completed-task claim.' };
    }
    if (action === 'release') throw new Error('Release by child id is unavailable through this native task contract. Native execution owns the activation; use interrupt to stop current work without closing the parent or Team tree.');
    throw new Error('Unknown control action; choose status, continue or interrupt.');
  }
  async result(request: JsonObject, actor?: RuntimeAgent, signal = new AbortController().signal): Promise<JsonObject> {
    const childId = requiredString(request.childId, 'childId');
    const run = this.runForChild(childId, actor);
    const snapshot = this.store.snapshots().find(value => value.id === run.revision);
    const diagnostics = snapshot ? await this.presets.audit([snapshot.presetId], signal) : ['This task is missing its immutable role snapshot.'];
    signal.throwIfAborted();
    const result = await readRunResult(this.sessions, run, request.offset ?? 0, request.limit ?? 12_000, request.resultRevision, signal);
    return { ...result, diagnostics: [...diagnostics, ...(Array.isArray(result.diagnostics) ? result.diagnostics : [])] };
  }
  private async reconcile(run: RunRecord, signal?: AbortSignal): Promise<RunRecord> {
    if (run.childId || run.phase === 'failed' || this.starts.has(run.id)) return run;
    const snapshot = this.store.snapshots().find(value => value.id === run.revision);
    const lookup = await this.sessions.startup(run, snapshot?.presetId, signal);
    if (lookup.kind === 'missing') return run;
    if (lookup.kind !== 'matched') throw new Error(lookup.message);
    const repaired: RunRecord = { ...run, childId: lookup.childId, phase: 'accepted' };
    delete repaired.error;
    await this.store.run(repaired);
    return repaired;
  }
  async runs(actor?: RuntimeAgent, signal?: AbortSignal, parentId?: string): Promise<JsonObject> {
    const recorded = this.store.runs().filter(run => !actor || run.parentId === actor.id);
    const runs = [];
    for (const saved of recorded.filter(run => !parentId || run.parentId === parentId).slice(0, 200)) {
      let run = saved;
      try { run = await this.reconcile(saved, signal); }
      catch (error) { signal?.throwIfAborted(); run = { ...saved, error: `${saved.error ?? ''} Reconciliation: ${messageOf(error)}`.trim() }; }
      runs.push({ ...run, ...(run.childId ? { nativeStatus: this.sessions.status(run.childId) ?? 'not-resident' } : {}) });
    }
    return { runs, parentIds: [...new Set(recorded.map(run => run.parentId))] };
  }
  async operation(name: string, payload: unknown, actor?: RuntimeAgent, signal = new AbortController().signal): Promise<JsonObject> {
    const request = object(payload ?? {});
    switch (name) {
      case 'catalog': return this.catalog(actor, signal);
      case 'models': return this.models(actor, request, signal);
      case 'preview': return this.preview(requiredString(request.id, 'id'), actor, signal, request);
      case 'candidates': return this.candidates(requiredString(request.id, 'id'), actor, signal);
      case 'suggest': return this.suggest(request, actor, signal);
      case 'inspectDefinition': return { id: parseOverrideText(requiredString(request.text, 'text', 1024 * 1024)).id };
      case 'previewChange': return this.previewChange(request, actor, signal);
      case 'save': return this.save(request, actor, signal);
      case 'reset': return this.reset(request, actor, signal);
      case 'runs': return this.runs(actor, signal, optionalString(request.parentId, 'parentId'));
      case 'result': return this.result(request, actor, signal);
      default: throw new Error(`Unknown AgentDeck operation ${name}`);
    }
  }
  async dispose(): Promise<void> { await this.native.dispose(); await this.presets.dispose(); await this.store.close(); }
}
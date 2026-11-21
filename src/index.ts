import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { HostConnectionService, type HostConnectionRpc } from '@deepseek-ai/dsh-client-connection';
import { loadBuiltinAgents } from './core/index.js';
import { AgentDeckStore, WriteOutcomeUnknownError } from './host/store.js';
import { AgentDeckController, ChangeImpactError } from './host/controller.js';
import { ResultRevisionError } from './host/results.js';
import { SuggestionError } from './host/suggestions.js';
import { object, requiredString, optionalString, messageOf, jsonClone } from './host/types.js';
import type { HostContext, RuntimeAgent, JsonObject } from './host/types.js';
import type { ToolRunContext } from '@deepseek-ai/dsh-tools';

export const name = 'agentdeck';
export const inject = ['tools', 'subagents', 'agents', 'agentPresets', 'llm', 'sessionQuery', 'storageDomain', 'workingDirectory', 'systemPrompt'];
export const Config = z.object({ customAgentDirs: z.array(z.string()).default([]), projectConfigDirectory: z.string().default('.dsh/agentdeck'), allowNativeFallback: z.boolean().default(true) });

const output = {
  schema: { type: 'object' as const, additionalProperties: true as const },
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
};

export async function apply(context: HostContext, config: { customAgentDirs: string[]; projectConfigDirectory: string; allowNativeFallback: boolean }): Promise<void> {
  const ctx = context;
  const store = await AgentDeckStore.open(ctx);
  const controller = new AgentDeckController(ctx, store, config);
  ctx.effect(() => () => controller.dispose(), 'AgentDeck runtime');
  await controller.restore();

  const read = defineTool({
    name: 'scene_agent_catalog',
    description: 'Discover ready-to-use AgentDeck scene agents, their actual model options, native recovery and task records. Use general when no specialist fits. Availability includes the saved default route authorization for this Session; unknown is not approval. Read details only when needed; simple known-file work can use tools directly. Use candidates for the selected auto role to read its compact pool and revision. Role configuration is read-only through this tool. Use the owner management page to save or reset.',
    parameters: {
      action: { type: 'string', enum: ['list', 'get', 'models', 'preview', 'candidates', 'runs', 'save', 'reset'] },
      id: { type: 'string' }, cwd: { type: 'string', description: 'Target project directory for list, get, preview or candidates. Use the same cwd for start.' }, provider: { type: 'string' }, model: { type: 'string' },
      candidateId: { type: 'string' }, revision: { type: 'string' }, cursor: { type: 'string' },
    }, output,
    isConcurrencySafe: () => true,
    async execute(input: any, exec: ToolRunContext) {
      const args = object(input);
      const actor = exec.agent as RuntimeAgent | undefined;
      if (!actor) throw new Error('AgentDeck catalog requires a calling Agent.');
      let result: JsonObject;
      switch (args.action ?? 'list') {
        case 'list': {
          const catalog = await controller.catalog(actor, exec.signal, args.cwd);
          result = { agents: catalog.agents.map((agent: any) => ({ id: agent.id, title: agent.title, description: agent.description, enabled: agent.enabled, available: agent.available, capabilitiesAvailable: agent.capabilitiesAvailable,
              authorization: { status: agent.authorization.status, ...(agent.authorization.code ? { code: agent.authorization.code, policy: agent.authorization.policy } : {}) },
              ...(agent.configuredSelection ? { configuredSelection: { provider: agent.configuredSelection.provider, model: agent.configuredSelection.model } } : {}), missingCapabilities: agent.missingCapabilities, unverifiedCapabilities: agent.unverifiedCapabilities, capabilityCheck: agent.capabilityCheck, modelMode: agent.model.mode, revision: agent.revision })), diagnostics: catalog.diagnostics };
          break;
        }
        case 'get': {
          const catalog = await controller.catalog(actor, exec.signal, args.cwd);
          const selected = catalog.agents.find((agent: any) => agent.id === args.id);
          if (!selected) throw new Error('Unknown or invalid role id. Query list before selecting a role.');
          result = { agent: selected, override: catalog.overrides.find((row: { id: string }) => row.id === selected.id) ?? null };
          break;
        }
        case 'models': result = await controller.models(actor, args, exec.signal); break;
        case 'preview': result = await controller.preview(requiredString(args.id, 'id'), actor, exec.signal, args); break;
        case 'candidates': result = await controller.candidates(requiredString(args.id, 'id'), actor, exec.signal, args.cwd); break;
        case 'runs': result = await controller.runs(actor, exec.signal, undefined, optionalString(args.cursor, 'cursor')); break;
        case 'save':
        case 'reset': throw new Error('AGENTDECK_OWNER_CONFIGURATION_REQUIRED: Save or reset roles on the owner management page.');
        default: throw new Error('Unknown catalog action.');
      }
      return jsonClone(result);
    },
  });
  const start = defineTool({
    name: 'scene_agent_start',
    description: 'Delegate a self-contained authorized task to an AgentDeck role on the native DSH chain. Omit role or choose general when no specialist fits. The tool returns a child Session id immediately and native completion arrives later. Check catalog authorization for the saved default before dispatch; denied routes require owner action, not an automatic model or role switch. Preserve user scope; do not fall back around a refusal or repeat work after uncertain startup. For an auto role, read its compact catalog candidates and submit the matching revision plus optional candidateId/candidateReason; omitted candidate uses the configured default. No classifier call or candidate retry is performed.',
    parameters: {
      role: { type: 'string' }, prompt: { type: 'string', required: true }, description: { type: 'string' },
      cwd: { type: 'string' }, provider: { type: 'string' }, model: { type: 'string' }, reasoning_effort: { type: 'string' },
      candidateId: { type: 'string' }, revision: { type: 'string' }, candidateReason: { type: 'string' },
    }, output,
    isConcurrencySafe: () => true,
    async execute(args: any, exec: ToolRunContext) { return jsonClone(await controller.start(object(args), exec)); },
  });
  const control = defineTool({
    name: 'scene_agent_control',
    description: 'Control your direct AgentDeck child by its childId, including from an Agent Teams parent. These ids are native child Sessions, not Team member targets. Continue accepts a message without waiting for a reply; interrupt stops the current turn. Native execution owns activation release. Status does not turn inactivity into successful completion.',
    parameters: {
      action: { type: 'string', required: true, enum: ['status', 'continue', 'interrupt'] },
      childId: { type: 'string', required: true }, message: { type: 'string' },
    }, output,
    isConcurrencySafe: () => true,
    async execute(args: any, exec: ToolRunContext) {
      if (!exec.agent) throw new Error('Control requires a real parent Agent.');
      return jsonClone(await controller.control(object(args), exec.agent as RuntimeAgent, exec.signal));
    },
  });
  const result = defineTool({
    name: 'scene_agent_result',
    description: 'Read evidence and paged final output of your AgentDeck child when the native completion notice is insufficient. To continue, pass nextOffset as offset and include resultRevision from the first page. Reload the first page if the result changes. Inspect status and coverage before accepting success. This read does not resume or repeat the task.',
    parameters: { childId: { type: 'string', required: true }, offset: { type: 'number' }, limit: { type: 'number' }, resultRevision: { type: 'string' } },
    output, isConcurrencySafe: () => true,
    async execute(args: any, exec: ToolRunContext) {
      if (!exec.agent) throw new Error('Result access requires a real parent Agent.');
      return jsonClone(await controller.result(object(args), exec.agent as RuntimeAgent, exec.signal));
    },
  });
  for (const definition of [read, start, control, result]) ctx.effect(() => ctx.tools.register(definition), definition.name);

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'agentdeck:dispatch', order: 610, interpolate: false,
    text: (assembly: any) => !ctx.tools.get('scene_agent_start', assembly.scope, assembly.toolSet) ? '' : [
      'AgentDeck provides complete scene agents through scene_agent_start. Use a specialist for substantial independent work; simple local operations may stay inline or use an available Skill. Do not infer that the presence of a role authorizes an action.',
      'Choose general (the default) for unmatched or ambiguous tasks. Unknown ids and disabled roles are errors, not implicit fallback. Explicit user role choice must not silently change. Discover actual model ids/efforts before overriding them.',
      'Starts return a child Session id. Native completion is delivered automatically; do not poll. Use scene_agent_control for these children, not Agent Teams target-name controls. On failures preserve completed work and scope; policy refusal must not trigger another route. Uncertain startup must be reconciled before creating another task.',
      `Factory roles: ${loadBuiltinAgents().map(agent => `${agent.id}: ${agent.description.en}`).join('; ')}`,
      'User/project extensions and current Session availability are in scene_agent_catalog. Check default-route authorization before dispatch. A denied default requires owner action; do not silently switch models or roles. Unknown authorization is not approval. For an auto role read only its compact candidates, choose from that pool using task scope, and pass candidateId plus revision; otherwise its default is used. Do not load all pools or run a classifier. Role configuration writes belong to the owner UI. Read result detail only when the completion notice is insufficient. Do not claim efficiency improvements without measurement.',
    ].join('\n'),
  }), 'AgentDeck main-agent guidance');

  // The native API Gateway owns the single shared /api interceptor.
  ctx.inject(['connection', 'webServer'], (connected: HostContext) => {
    // In 0.2.2-rc.3 the ordinary getter shadows this into Connection's definition
    // context, which lacks webServer. Bind its public accessor to the consumer
    // proxy so native registration uses this fiber's declared dependencies.
    const readRpc = Object.getOwnPropertyDescriptor(HostConnectionService.prototype, 'rpc')?.get;
    if (!readRpc) throw new Error('The native Connection RPC registry accessor is unavailable.');
    const rpc: HostConnectionRpc = readRpc.call(connected.connection);
    connected.effect(() => rpc.handle('/agentdeck', async (endpoint: string, payload: unknown, signal: AbortSignal, peer: any) => {
      if (peer?.principal?.kind !== 'owner') return { ok: false, error: { code: 'AGENTDECK_OWNER_REQUIRED', message: 'Only the authenticated owner can manage AgentDeck.', details: {} } };
      try {
        if (!endpoint.startsWith('agentdeck.')) throw new Error(`Unknown AgentDeck endpoint: ${endpoint}`);
        const args = object(payload ?? {});
        const sessionId = optionalString(args.sessionId, 'sessionId');
        const actor = controller.agent(sessionId);
        if (sessionId && !actor) throw new Error('The selected Session is not live. Select a current Session to resolve inherited settings.');
        const value = await controller.operation(endpoint.slice('agentdeck.'.length), args, actor, signal);
        return { ok: true, value: jsonClone(value) };
      } catch (error) {
        const code = error instanceof ChangeImpactError ? error.code
          : error instanceof ResultRevisionError ? 'AGENTDECK_RESULT_CHANGED'
          : error instanceof WriteOutcomeUnknownError ? 'AGENTDECK_WRITE_OUTCOME_UNKNOWN'
          : error instanceof SuggestionError ? error.code : 'AGENTDECK_OPERATION_FAILED';
        return { ok: false, error: { code, message: messageOf(error), details: error instanceof SuggestionError ? error.details : {} } };
      }
    }), 'AgentDeck owner RPC');
  });
}

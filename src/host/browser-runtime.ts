import { randomUUID } from 'node:crypto';
import { FiberState } from '@deepseek-ai/cordis';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import type { HostContext, RuntimeAgent } from './types.js';
import type { BrowserEvidence, BrowserInvocationScope } from './browser.js';

/** A bounded, read-only CLI probe. Never starts a daemon or changes local trust. */
export async function browserReadiness(ctx: HostContext, signal: AbortSignal): Promise<NonNullable<BrowserEvidence['bsk']>> {
  const subprocess = ctx.get('subprocess' as any) as any;
  if (!subprocess) return { state: 'unsupported', reason: 'BrowserSkill readiness requires the native subprocess service.' };
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(new Error('BrowserSkill readiness exceeded 5000 ms.')), 5000);
  const control = AbortSignal.any([signal, timeout.signal]);
  let handle: any;
  let joined = false;
  try {
    control.throwIfAborted();
    const editor = ctx.get('configEditor');
    if (!editor) throw new Error('BrowserSkill active configuration is unavailable; readiness cannot verify which CLI the plugin uses.');
    const entries = editor.entries().filter((entry: { options: { name?: string }; fiber?: { state: number } }) => entry.options.name === '@wxg-prc-cpg/browser-skill-dsh-plugin' && entry.fiber?.state === FiberState.ACTIVE);
    if (entries.length !== 1) throw new Error('BrowserSkill readiness requires exactly one active configured plugin instance.');
    const config = entries[0].fiber.effectiveConfig;
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('BrowserSkill active effective configuration is unavailable.');
    const bskPath = config.bskPath ?? 'bsk';
    if (typeof bskPath !== 'string' || !bskPath.trim() || bskPath.includes('\0')) throw new Error('BrowserSkill configured CLI path is invalid.');
    const executable = await subprocess.resolveExecutable(bskPath, undefined, control);
    handle = subprocess.spawn({ argv: [executable, 'status', '--json'], cwd: process.cwd(), signal: control, graceMs: 500,
      env: { BSK_AUTO_START: '0' }, stdio: { stdin: 'ignore', stdout: { maxBytes: 65_536 }, stderr: { maxBytes: 4096 } } });
    const outcome = await handle.done;
    joined = await handle.waitForExit();
    control.throwIfAborted();
    if (!joined || outcome.exitCode !== 0) throw new Error('BrowserSkill daemon is unavailable; restore the existing daemon and verified extension connection.');
    const output = handle.collected.stdout?.readFrom(0);
    if (!output || output.lossy) throw new Error('BrowserSkill readiness response was unavailable or exceeded its limit.');
    const status = JSON.parse(output.text);
    if (status.local_auth?.mode !== 'required' || !(status.local_auth?.paired_devices > 0)) throw new Error('BrowserSkill requires the existing Required verification mode and a paired device; no trust settings were changed.');
    const browsers = Array.isArray(status.browsers) ? status.browsers : [];
    if (!browsers.some((browser: any) => typeof browser.instance_id === 'string' && !browser.unresponsive && !browser.version_skew && browser.extension_protocol_version === status.protocol_version)) throw new Error('No responsive BrowserSkill extension with a compatible protocol is connected.');
    return { state: 'ready', reason: 'BrowserSkill CLI and daemon responded; a compatible extension is connected with Required local verification and a paired device. Session creation still follows native policy.' };
  } catch (error) {
    signal.throwIfAborted();
    return { state: 'unverified', reason: timeout.signal.aborted ? 'BrowserSkill readiness exceeded 5000 ms; no browser was opened.' : error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
    if (handle && !joined) { handle.terminate(); await handle.done.catch(() => undefined); await handle.waitForExit(); }
  }
}

/** Exact-agent receipts, never the BrowserSkill plugin's process-wide current session. */
export class OwnedBrowserSessions {
  private readonly sessions = new Set<string>();
  private cleanup?: Promise<void>;
  private closing = false;
  constructor(private readonly ctx: HostContext, private readonly agent: RuntimeAgent) {}
  get scope(): BrowserInvocationScope { return { sessionIds: [...this.sessions] }; }
  observe(execution: any, result: any): void {
    if (execution.agent !== this.agent || execution.name !== 'bsk_session' || result.isError) return;
    const args = execution.arguments;
    const value = result.value;
    if (args?.action === 'start' && typeof value?.sessionId === 'string' && typeof value?.browserInstanceId === 'string') this.sessions.add(value.sessionId);
    if (args?.action === 'stop' && typeof args.session === 'string' && this.sessions.has(args.session) && value?.stopped === args.session) this.sessions.delete(args.session);
  }
  denial(name: string, args: any): string | undefined {
    if (name === 'bsk_session' && args?.action === 'start' && this.closing) return 'This AgentDeck browser task is closing; it cannot create another session.';
    return undefined;
  }
  /** Called while scoped native tools/guards still exist; cleanup ignores turn cancellation. */
  close(): Promise<void> {
    if (this.cleanup) return this.cleanup;
    this.closing = true;
    const work = this.closeOwned();
    this.cleanup = work;
    work.finally(() => { if (this.cleanup === work) this.cleanup = undefined; this.closing = false; }).catch(() => undefined);
    return work;
  }
  private async closeOwned(): Promise<void> {
    if (!this.sessions.size) return;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error('AgentDeck browser cleanup exceeded 10000 ms; native ownership is retained.')), 10_000);
    let toolSet: any;
    try {
      const modelSelection = this.agent.model.current();
      if (!modelSelection) throw new Error('The browser child has no model selection for native cleanup.');
      toolSet = await this.ctx.tools.resolve({ agent: this.agent, modelSelection, signal: timeout.signal });
      for (const session of [...this.sessions]) {
        const batch = await this.ctx.tools.execute({ agent: this.agent, signal: timeout.signal, toolSet,
          calls: [{ type: 'tool-call', id: ToolCallId(`agentdeck-browser-stop-${randomUUID()}`), name: 'bsk_session', arguments: JSON.stringify({ action: 'stop', session }) }] });
        const result = batch.results[0]?.result;
        if (!result || result.isError || typeof result.value !== 'object' || result.value === null || Array.isArray(result.value) || result.value.stopped !== session) throw new Error(`Could not confirm cleanup of AgentDeck browser session ${session}; its ownership is retained.`);
        this.sessions.delete(session);
      }
    } finally { clearTimeout(timer); toolSet?.dispose(); }
  }
}

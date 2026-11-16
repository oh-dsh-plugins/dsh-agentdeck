import type { AgentDefinition } from '../core/index.js';
import { browserToolAllowed, type BrowserSupport } from './browser.js';

const readTools = new Set(['read', 'read_image', 'glob', 'grep', 'lsp', 'session_search', 'session_trace', 'session_read']);
const sourceTools = new Set(['write', 'edit', 'apply_patch']);
const webTools = new Set(['web_search', 'web_fetch']);
const browserObserve = /(?:take_snapshot|take_screenshot|list_pages|list_console_messages|list_network_requests|get_console_message|get_network_request|get_css_styles|wait_for)$/;
const browserInteract = /(?:click|fill|fill_form|hover|press_key|navigate_page|new_page|close_page|resize_page|emulate)$/;
const browser = (name: string) => name.startsWith('mcp__chrome-devtools__') || name.startsWith('mcp__browser__');

export function toolAllowed(name: string, capabilities: readonly string[], support?: BrowserSupport): boolean {
  if (name === 'agentdeck_skill' || name === 'agentdeck_read_attachment') return true;
  if (readTools.has(name)) return capabilities.includes('files-read');
  if (sourceTools.has(name)) return capabilities.includes('source-edit') || capabilities.includes('artifact-write');
  if (webTools.has(name)) return capabilities.includes('web-research');
  if (name === 'agentdeck_run_project_script') return capabilities.includes('project-runner');
  if (name === 'agentdeck_parse_data') return capabilities.includes('data-query');
  if (name.startsWith('mcp__context7__')) return capabilities.includes('web-research');
  if ((browser(name) || name.startsWith('bsk_')) && support) return browserToolAllowed(name, capabilities, support);
  if (browser(name) && browserObserve.test(name)) return capabilities.includes('browser-observe') || capabilities.includes('browser-interact');
  if (browser(name) && browserInteract.test(name)) return capabilities.includes('browser-interact');
  return false;
}

export interface CapabilityEnvironment { files: boolean; runner: boolean; skills: boolean; meter: boolean; web?: boolean }
/** File tools come from the independent child preset; external tools must be global. */
export function missingCapabilities(role: AgentDefinition, globalNames: readonly string[], environment?: CapabilityEnvironment): string[] {
  const env = environment ?? { files: globalNames.includes('read'), runner: globalNames.includes('agentdeck_run_project_script'), skills: true, meter: true };
  const missing: string[] = [];
  for (const capability of role.capabilities) {
    let available = true;
    switch (capability) {
      case 'files-read': case 'source-edit': case 'artifact-write': case 'data-query': available = env.files; break;
      case 'project-runner': available = env.runner && role.scripts.some(path => ['assets/scripts/project-checks.mjs', 'assets/scripts/csv-profile.mjs'].includes(path)); break;
      case 'web-research': available = !!env.web || globalNames.some(name => webTools.has(name) || name.startsWith('mcp__context7__')); break;
      case 'browser-observe': available = globalNames.some(name => browser(name) && browserObserve.test(name)); break;
      case 'browser-interact': available = globalNames.some(name => browser(name) && browserInteract.test(name)); break;
    }
    if (!available) missing.push(capability);
  }
  if (role.skills.length && !env.skills) missing.push('native-skills');
  if (!env.meter) missing.push('native-token-meter');
  return missing;
}

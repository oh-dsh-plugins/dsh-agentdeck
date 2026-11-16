# Security policy

## Supported scope

The current supported source baseline is AgentDeck 0.2.4 with DSH 0.2.2-rc.3. Compatibility and security properties of other host versions are unverified. This community project does not offer a response-time guarantee.

## Reporting a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/oh-dsh-plugins/dsh-agentdeck/security/advisories/new) for issues involving authorization, credentials, unintended data exposure or execution. Include the affected versions, a minimal benign reproduction, the reachable code path and expected/actual behavior.

Do not publish exploit instructions, API keys, native Session histories, pairing links or wallet information in a public issue. If private reporting is unavailable, open a minimal issue asking for a private contact channel without disclosing vulnerability details.

Ordinary bugs and feature requests belong in [GitHub Issues](https://github.com/oh-dsh-plugins/dsh-agentdeck/issues).

## Relevant boundaries

AgentDeck relies on DSH's native authorization and execution pipeline. Model discovery is not a permission grant. Role capabilities are task-scoped, read-only roles remain restricted, and native policy/capacity refusal is not retried through another route.

BrowserSkill sessions must belong to the exact child that created them. The plugin does not change pairing, trust policy, provider credentials or browser profile settings. Custom role definitions, skills, project scripts and configured services must be reviewed within the user's authorized task.

Disabling or uninstalling the plugin is not data erasure: native conversation history and plugin-owned persisted records can remain. Review the [data section](README.md#data-and-removal) before sharing diagnostics or archives.

# Core module contract

Core modules use Node standard APIs and the declared YAML dependency, without DSH services. Their module API is exported from src/core/index.ts. This document describes source-level integration contracts; the package's supported runtime entry points are declared in package.json.

## Types

- LocalizedText = { en: string; zh: string }.
- AgentDefinition: schemaVersion: 1 | 2 | 3; id: string; title/description: LocalizedText; instructions: string; capabilities/skills/scripts/inputs/deliverables: string[]; model: inherit, fixed or auto; reasoning: inherit-compatible, model-default or fixed; enabled: boolean; extends?: string. Active catalog definitions always normalize to schemaVersion 3 and have no output or context quota.
- ModelCandidate: { id: string; purpose: string; provider: string; model: string; reasoning: { mode: 'model-default' | 'fixed'; effort?: string } }. Auto requires at least one unique candidate, a valid default and role reasoning model-default. Purpose is at most 240 characters. Version 3 rejects retired resource fields; version 1/2 compatibility reads discard those fields before resolving active definitions.
- Capability identifiers: 'files-read', 'source-edit', 'project-runner', 'web-research', 'browser-observe', 'browser-interact', 'data-query', 'artifact-write'. Only factory roles requiring execution/editing carry those capabilities. General defaults to read/research and may be explicitly specialized within task authorization; do not make it an unrestricted agent.
- SkillDefinition: id: string; description: string; body: string.
- AgentDiagnostic: id?: string; source?: string; message: string.
- CatalogResult: agents: AgentDefinition[]; diagnostics: AgentDiagnostic[].

## Exports

- loadBuiltinAgents(): AgentDefinition[] (13 factory roles plus 3 variants; deterministic ordering; general first).
- loadBuiltinSkills(): SkillDefinition[] (full English instruction bodies; assets may be read from package-relative URLs).
- validateAgent(value: unknown): AgentDefinition (reject unknown fields and invalid ids/model pairs; normalize documented legacy resource fields).
- parseOverrideText(text: string): Record<string, unknown> (YAML schemaVersion=1|2|3, max 1 MiB, reject unsafe/unknown shapes via resolution).
- resolveCatalog(overrides?: readonly { source: string; text: string; failure?: string }[]): CatalogResult (factory + ordered overrides; deterministic inheritance, detect cycles, isolate bad roles).
- agentRevision(agent: AgentDefinition): string (stable canonical content SHA-256, suitable for lowercase preset suffix).
- resolveContextBudget(input: { windowTokens?: number; outputTokens?: number; fixedTokens?: number; targetTokens: number; elasticTokens: number }): { known: boolean; targetTokens: number; elasticTokens: number; safeInputTokens?: number; headroomTokens: number; materialTokens?: number; diagnostics: string[] }. Legacy policy-one compatibility utility only; new task admission does not call it.

## Override shape

id is required. Existing factory ids override factory values; new ids use extends or provide a complete definition. instructions accepts string or { append?: string; replace?: string }. capabilities/skills/scripts accept arrays (explicit replace) or { add?: string[]; remove?: string[]; replace?: string[] }. Other definition fields are validated shallow partial overrides and then resolved to a complete AgentDefinition. displayName string is accepted as a convenience alias for both title locales. Unknown fields are errors. Broken overrides must not silently fall back to a different role under the same id; disable/remove that resolved role and emit diagnostics. Other roles remain usable.

Version 1/2 sources remain readable without rewriting their YAML. Resolution drops legacy output/context quotas and candidate maxTokens, then produces version 3. New version 3 sources reject those fields. Mode changes clear incompatible inherited routes/candidates; candidate arrays replace the entire pool. Structured editing upgrades only the edited document. Historical policyVersion 1 execution snapshots retain their original normalized role, selected native parameters and isolated recovery. New policyVersion 2 snapshots contain no role budget or selected output cap and inherit host recovery.

## Factory role ids

general, code-scout, researcher, reader, architect, implementer, test-runner, test-designer, debugger, reviewer, ui-verifier, data-analyst, docs-writer, security-reviewer, performance-debugger, long-document-reader.

## Native integration boundaries

Host application code depends on TaskCommands, SessionQueries and ModelQueries in src/host/contracts.ts. NativeDelegator preserves the original ToolRunContext and execution pipeline; NativeSessionQueries owns root discovery, projections and startup evidence; model queries own route resolution and normalized model views. The plugin entry composes these defaults, while tests may supply narrow ports. Core definitions and portable model files have no native SDK shape dependency.

The published rc.1 activation receipt contains subagentId; rc.2 and later contain name, resolved with the original actor and signal. Root discovery selects native rootOf or legacy agents.roots by structural capability. Version diagnostics report the loaded native package separately from the minimum supported version. Structural capability, verified behavior and Session authorization are separate facts.

Startup stays starting/accepted/failed/uncertain. Only proven pre-dispatch failure permits fallback; unknown receipts, missing projections and ambiguous matches never cause another dispatch. Recovery requires one exact task label plus matching native parent and immutable preset. Execution outcome is independent: unknown terminal shapes retain raw evidence as finished-unverified with diagnostics.

Model views have stable provider/id/name/label fields, normalized efforts {id,label,name,description?}, optional positive finite capacities, and no authorization grant. The name alias retains the existing Client transport. Unknown or malformed native model policy is distinct from absent policy and blocks authorization until understood. Snapshots and portable files keep their own schema versions; host upgrades do not rewrite them. Native resources remain opaque references validated by their owner.

## Source layout

Core validation and catalog code live in src/core, factory definitions and skills in assets, and core checks in test/core-*.test.mjs. Host integration lives in src/host, src/index.ts and src/role.ts.

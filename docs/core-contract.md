# Core module contract

Core modules use Node standard APIs and the declared YAML dependency, without DSH services. Their module API is exported from src/core/index.ts. This document describes source-level integration contracts; the package's supported runtime entry points are declared in package.json.

## Types

- LocalizedText = { en: string; zh: string }.
- AgentDefinition: schemaVersion: 1 | 2; id: string; title: LocalizedText; description: LocalizedText; instructions: string; capabilities: string[]; skills: string[]; scripts: string[]; inputs: string[]; deliverables: string[]; model: { mode: 'inherit' | 'fixed' | 'auto'; provider?: string; model?: string; candidates?: ModelCandidate[]; defaultCandidate?: string }; reasoning: { mode: 'inherit-compatible' | 'model-default' | 'fixed'; effort?: string }; output?: { maxTokens: number }; context: { targetTokens: number; elasticTokens: number }; enabled: boolean; extends?: string.
- ModelCandidate: { id: string; purpose: string; provider: string; model: string; reasoning: { mode: 'model-default' | 'fixed'; effort?: string }; maxTokens: number }. Only v2 supports output and auto. Auto requires 1–3 unique candidates, a valid default, role reasoning model-default and no role output; every candidate owns its output cap. Purpose is at most 240 characters. Strict unknown-field and positive safe-integer validation applies.
- Capability identifiers: 'files-read', 'source-edit', 'project-runner', 'web-research', 'browser-observe', 'browser-interact', 'data-query', 'artifact-write'. Only factory roles requiring execution/editing carry those capabilities. General defaults to read/research and may be explicitly specialized within task authorization; do not make it an unrestricted agent.
- SkillDefinition: id: string; description: string; body: string.
- AgentDiagnostic: id?: string; source?: string; message: string.
- CatalogResult: agents: AgentDefinition[]; diagnostics: AgentDiagnostic[].

## Exports

- loadBuiltinAgents(): AgentDefinition[] (13 factory roles plus 3 variants; deterministic ordering; general first).
- loadBuiltinSkills(): SkillDefinition[] (full English instruction bodies; assets may be read from package-relative URLs).
- validateAgent(value: unknown): AgentDefinition (reject unknown fields, invalid ids/model pairs/budget ranges; no silent drops).
- parseOverrideText(text: string): Record<string, unknown> (YAML schemaVersion=1|2, max 1 MiB, reject unsafe/unknown shapes via resolution).
- resolveCatalog(overrides?: readonly { source: string; text: string; failure?: string }[]): CatalogResult (factory + ordered overrides; deterministic inheritance, detect cycles, isolate bad roles).
- agentRevision(agent: AgentDefinition): string (stable canonical content SHA-256, suitable for lowercase preset suffix).
- resolveContextBudget(input: { windowTokens?: number; outputTokens?: number; fixedTokens?: number; targetTokens: number; elasticTokens: number }): { known: boolean; targetTokens: number; elasticTokens: number; safeInputTokens?: number; headroomTokens: number; materialTokens?: number; diagnostics: string[] }.

## Override shape

id is required. Existing factory ids override factory values; new ids use extends or provide a complete definition. instructions accepts string or { append?: string; replace?: string }. capabilities/skills/scripts accept arrays (explicit replace) or { add?: string[]; remove?: string[]; replace?: string[] }. Other definition fields are validated shallow partial overrides and then resolved to a complete AgentDefinition. displayName string is accepted as a convenience alias for both title locales. Unknown fields are errors. Broken overrides must not silently fall back to a different role under the same id; disable/remove that resolved role and emit diagnostics. Other roles remain usable.

Version 1 reads and revision hashes remain unchanged; no automatic rewrite is performed. New fields require version 2. Mode changes clear incompatible inherited route/candidate fields; candidate arrays replace the whole pool rather than merging by position. An override output:null clears the optional output cap. Historical execution snapshots retain their original normalized role and selected native parameters.

## Factory role ids

general, code-scout, researcher, reader, architect, implementer, test-runner, test-designer, debugger, reviewer, ui-verifier, data-analyst, docs-writer, security-reviewer, performance-debugger, long-document-reader.

## Source layout

Core validation and catalog code live in src/core, factory definitions and skills in assets, and core checks in test/core-*.test.mjs. Host integration lives in src/host, src/index.ts and src/role.ts.

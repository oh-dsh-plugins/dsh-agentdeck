# Static Client and Host operation contract

This installed plugin uses the public Connection RPC carrier. When connection and webServer are available, Host registers connection.rpc.handle('/agentdeck', handler) and accepts namespaced agentdeck.* methods. The native API Gateway owns the exclusive shared /api interceptor. On the published 0.2.2-rc.1 through rc.5 connection contract, explicitly call the public HostConnectionService.prototype rpc getter with the consumer service proxy; ordinary getter access shadows the dependency context and makes native handle() unable to read webServer. Both dependencies must still be declared by the consumer. This binding changes no service state or native registration logic. The dedicated channel retains native Host/Origin and authentication checks. Its handler admits only owner peers, validates payloads, and calls the same operation functions used by agent tools. UI-only save/reset/import operations are not model authority grants and must never mutate native model authorization.

## Client integration

The client is one self-contained window.__ModuleLoader__ factory in src/client/index.js. It uses the host React, settings.section slot, theme tokens, locale and Connection RPC; it does not create an alternate application root. Reads have abort propagation and a 15-second deadline; suggestion generation has a 120-second deadline. Save/reset have no automatic deadline or replay. Unmount and superseded requests cancel reads while retaining drafts. Session selection is optional and supplies execution authorization context only.

## Role editing and AI suggestions

The role editor offers inherit, fixed and auto candidate modes. Only fixed/auto display the inline AI entry. There is no batch setup wizard or resource migration dialog. Generator provider/model options are globally configured choices, independent of the execution route and current Session. Directory and optional metadata failures are visible diagnostics; the selected generator still receives the actual request. Missing saved options remain visible without silently changing them.

- Fixed generation suggests one route and reasoning setting. A complete explicit fixed route in the draft is a constraint.
- Auto generation suggests candidate purposes, routes, reasoning and a default. A pool needs at least one item; there is no three-candidate ceiling.
- Results show the explanation and before/after settings. Adopt changes only model/reasoning in the current draft. Normal Save remains separate.
- Draft text/form/kind, saved role revision, generator or requirements changes invalidate adoption and abort pending generation. Late results are discarded. Raw YAML drafts must first be resolved before structured adoption.
- Auto to fixed seeds the default candidate. Auto to inherit restores native inheritance. Fixed to auto seeds the current route. No output cap or context budget is carried between modes.
- Failure notices display the actual cause, stage and generator route. Raw response and longer details remain expandable. Partial or malformed generation is never silently saved.

## Portable model configuration

The Agents toolbar exports selected saved roles as UTF-8 JSON with format `dsh-agentdeck-models`, version 1 and roles containing only id, model and reasoning. Files are bounded to 1 MiB. Candidate IDs, purposes, order and default are preserved; provider credentials, paths, role instructions and skills are excluded through reconstruction from an allowlist.

Import is global-only. Missing role IDs require explicit local targets; duplicate targets, externally owned sources, dirty drafts, changed revisions, absent providers, unresolved metadata, non-text models and unsupported fixed efforts block adoption. Each route may be explicitly remapped; a role may be skipped, or an auto candidate removed while preserving a nonempty pool and explicitly selecting a new default first. Native Session authorization stays independent of model discovery.

Existing owner previewChange validates schemaVersion 3/model/reasoning actions and returns exact materialized text. All selected previews and unchanged draft references/revisions are required before any draft is replaced. Closing the panel or changing Session discards late responses. Metadata lookup failures invalidate compatibility even if older metadata remains cached. Import stages protected drafts only; each ordinary Save obtains a fresh preview, CAS revision and native indirect-impact consent. No bulk Host mutation or automatic write/replay is introduced.

## Read operations

- agentdeck.catalog {sessionId?}: agents, diagnostics, overrides, runtime and sessions. AgentView includes revision, ownership, static capabilities, configured selection and native Session authorization. Model discovery does not grant authorization.
- agentdeck.models {sessionId?,provider?,model?,view?}: providers, model rows, selection/policy and diagnostics. The options view lists provider/model options lazily without per-row metadata. The retained setup-options transport name means globally configured suggestion options; it ignores Session policy and performs no exact metadata lookup. Exact metadata remains advisory and independently scoped by route.
- agentdeck.preview {id,sessionId?,candidateId?,revision?}: agent, model, configured/effective/session selection, authorization, recovery:{policy:'native',contextWindow?}, diagnostics. No role output, capacity estimate or budget is returned. Unknown windows remain unknown; native startup still validates route and parameters.
- agentdeck.candidates {id,sessionId?}: id, revision, mode, defaultCandidate and compact candidates with purpose, route, reasoning and authorization. It does not load other pools or the complete model directory. Auto starts require the returned revision; omitted candidate uses the default. No alternate candidate is tried after a denial.

## Owner operations

- agentdeck.suggest {version:1,id,revision?,definition,generator:{provider,model},requirements?}: {id,revision?,mode,model,reasoning,reason,generator,diagnostics?}. Mode is fixed or auto from the draft. The Host checks a supplied saved revision before and after generation. It uses the selected generator through public llm.stream, without a plugin output cap, context admission gate or Session authorization filter. Generated settings are validated as schema 3 before returning. Errors retain stage, generator route and rawResponse.
- agentdeck.inspectDefinition {text}: {id}, using bounded strict parsing and exact draft identity.
- agentdeck.previewChange {id,text?,actions?,reset?,expectedRevision?,sessionId?}: exact final YAML/deletion intent, current revision, direct before/after definitions, diagnostics, indirect impacts and impactRevision. Structured actions only edit schemaVersion, enabled, model and reasoning, preserving unrelated YAML/comments. An edited legacy document upgrades to schema 3 and removes its retired quota fields.
- agentdeck.save {id,text,expectedRevision?,impactRevision?,acceptedIndirectRoles?,sessionId?}: {id,revision,text}. New/updated YAML accepts schema 1/2/3 under the documented compatibility rules. Existing sources remain source-owned; derive them or edit their owning file. Saves use exact preview text, revision checks and indirect-impact consent. Unknown write outcomes require exact readback and never automatic replay.
- agentdeck.reset uses the same preview/revision/impact safeguards. Import, export, derive and ordinary save preserve unrelated fields and source ownership. Factory definitions remain immutable.
- Removed batch recommend, previewSetup and applySetup operations are unsupported.

## Tasks and recovery

Runtime catalog/start/control/result stay on native DSH delegation. Policy, caller identity, cancellation, leaf restrictions, persistence, completion delivery and Team coexistence remain native. Task controls are restricted to the direct parent's children. Inactivity does not establish success. Control continues or interrupts the existing child; it does not silently create a replacement.

New policyVersion 2 snapshots pin role/skills/model revisions without plugin output or input quotas. They inherit the host's native compaction service. Historical policyVersion 1 snapshots restore their frozen limits and isolated compaction. Native pre-request pressure and standard provider-overflow recovery may compact historical messages and retry the current request after a durable reduction. Completed tools are not replayed. Irreducible fixed input can still fail. Native max-tokens ends as partial with retained text and supports continuation in the same child.

## Verification boundary

Use the existing GUI at http://127.0.0.1:3080 and the native plugin manager to load a local build. Do not start a replacement server or edit active profile files manually. Validate fixed/auto generation without Session selection, before/after adoption, separate Save, stale results, visible errors and removal of resource controls. Unit fixtures establish failure boundaries; actual GUI checks establish interaction/rendering, not universal model recommendation quality.

# Changelog

Notable source changes are recorded here. Version numbers identify the project source; they do not imply an npm publication or a GitHub Release.

## 0.3.1 — Task and project reliability

- Resolve saved role definitions and their parents against the target project's configuration. Use the same working directory for discovery, preview and startup, and show the effective configuration source in the management page.
- Preview inherited changes before saving. Require confirmation for changes that affect execution and keep uncertain reset results tied to the project used for the preview.
- Distinguish model validation from temporary lookup failures and check the dependencies of the selected compaction service. Record failures before native dispatch separately from uncertain startup outcomes.
- Read completion claims from the latest assistant message and retain native stop diagnostics. Add pagination for task history and long attachment lines, and bound the details returned with result pages.
- Correct CSV missing-value counts, literal Markdown heading hashes and repository inventory truncation indicators.

## 0.3.0 — DSH compatibility boundaries

- Support DSH >=0.2.2-rc.1 through one artifact and public host-selected task, Session and model adapters. Keep native caller identity, authorization, cancellation and completion.
- Normalize activation identities, root discovery and model labels/effort IDs at the Host boundary. Unknown model policies and terminal outcomes remain explicit instead of becoming authorization or failure claims.
- Preserve immutable role snapshots across host upgrades. Gate CI and release on the same archive in isolated rc.1–rc.5 hosts and persisted old-to-new continuation.

## 0.2.12 — AgentDeck management and write recovery

- Separate the role details, quick setup and run-history Session controls. Preserve proposals while inspecting roles, and require a fresh preview when the setup scope changes.
- Save sparse YAML overrides without flattening inherited settings. Preview indirect effects across known projects and require confirmation before affected writes, including intermediate effects in a batch.
- Read back uncertain saves, resets and batch rows before reporting that they landed. Keep unverified run results distinct from observed outcomes.
- Bound model directory lookups and preserve legacy derived roles when they inherit version 2 resources.

## 0.2.10 — Model picker and cross-project setup fixes

- Load authorized model choices before a role is selected. Preserve the selected generator, proposal and preview through temporary metadata failures.
- Bound model lookups and give later routes time to resolve when earlier lookups stall. Require text input support in AI-assisted and manual setup.
- Require consent for indirect resource changes across known projects, including project-defined roles with matching IDs. Preserve existing derived roles during global edits.
- Reject non-regular project role files without blocking configuration saves.

## 0.2.9 — Reliable AI-assisted setup

- Offer only generators allowed by the selected Session and clear stale setup previews when that policy changes.
- Send native text blocks, respect model input and output limits, and handle truncated or fenced JSON responses.
- Isolate invalid generated strategies to the affected role and skip model lookups for excluded or protected roles.
- Reject proposals when selected overrides change during generation and keep apply receipts within the originating Session.

## 0.2.8 — AI-assisted setup and configuration safeguards

- Generate separate candidate strategies for each selected role using an authorized model. Preserve protected roles and validate model metadata, cancellation, and response limits.
- Restrict configuration writes to the owner interface and prevent saves, resets, and batch prefixes from invalidating roles in the current session or global catalog.
- Bind result pagination to a single result revision so a new turn cannot mix with earlier pages.

## 0.2.7 — Progressive batch setup

- Align batch generation with native inherit, fixed and auto strategies, with shared complete candidates, explicit defaults and exact metadata only.
- Preserve configured/disabled/source-owned roles and dirty drafts by default; avoid redundant inheritance writes and require explicit resources when leaving candidate mode.
- Require version-bound acceptance of indirect resource changes at every saved prefix, including transient changes hidden by a successful final combination.
- Add progressive bilingual controls, count summaries, stale-consent fencing and native HTTP roundtrip coverage; retain legacy request and partial-save semantics.
- Require explicit boolean acceptance for indirect impacts, including roles whose IDs match JavaScript prototype names such as `constructor`.

## 0.2.6 — Localized setup and consistent readiness

- Add owner-only model setup with a selected default route, an optional image route, editable suggestions and explicit per-role apply results.
- Resolve the exact selected inheritance combination before applying, show impacts on read-only descendants and retain serial revision checks without automatic write replay.
- Share matching readiness evidence across role lists and details; invalidate stale previews, setup scopes and canceled apply readback on catalog or Session changes.
- Complete English/Chinese role contracts, skills and diagnostic presentation from one locale source while preserving custom text and native authorization.

## 0.2.5 — Session authorization and readiness fixes

- Add a version-tag Release workflow that tests and packs before publishing the same archive to npm through OIDC and attaching it to GitHub Releases with checksums.
- Add bilingual Release installation and maintainer instructions, including immutable-version checks, reruns and source-aligned npm provenance.
- Include the saved default model's Session authorization in role discovery, detail previews and availability filters; keep capability readiness separate from model authorization.
- Preserve matching live browser readiness in the list without confusing a selected candidate's authorization with the saved default route.
- Report a stable model-denial code, allowed explicit routes and owner recovery steps before creating a child. Preserve native validation, saved model choices and running task revisions.
- Keep missing Session context and invalid candidate previews unverified instead of claiming availability.
- Invalidate live preview evidence when a refresh or new preview starts, and cancel the previous preview before refreshing the catalog.
- Keep roles unverified after preview failure or timeout; ignore late responses and restore readiness only after a successful retry. Preserve unsaved drafts and model authorization.
- Consolidate the unpublished local 0.2.5/0.2.6 fixes into the next public version after 0.2.4: 0.2.5.

## 0.2.4 — Initial public package

- Prepare the first public npm package with compiled runtime resources, an explicit registry/access policy and bilingual npm installation instructions.

- Provide 13 complete scene agents and three specialist variants, 16 bundled skills and four standard-library helpers.
- Retain native DSH delegation, authorization, caller identity, cancellation, persistence, completion and Team coexistence.
- Add the bilingual native management page, source-aware overrides/derivation, atomic saves, task results and diagnostics.
- Support actual model/reasoning metadata, one to three inline model candidates, explicit output caps and total-input budgets.
- Verify BrowserSkill through its configured CLI and preserve exact child session ownership through completion, cancellation and disposal.
- Display browser readiness from the current matching preview without changing the lightweight static catalog.
- Record 173 passing checks on DSH 0.2.2-rc.3, plus an independent live browser lifecycle probe using a deterministic local model response.
- Prepare public English/Chinese documentation, repository metadata, contribution/security guidance and a check-only CI workflow. Exclude machine-local verification histories from source publication and package contents.

Earlier local builds were used during development. Their raw captures, native Session identities and machine-specific records are not part of the public repository.

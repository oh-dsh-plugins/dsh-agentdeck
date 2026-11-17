# Changelog

Notable source changes are recorded here. Version numbers identify the project source; they do not imply an npm publication or a GitHub Release.

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

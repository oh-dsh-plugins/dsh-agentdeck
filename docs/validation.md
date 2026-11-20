# Verification scope

[English README](../README.md) · [中文说明](../README.zh-CN.md)

## Compatibility verification

The declared DSH range is >=0.2.2-rc.1 without an artificial upper bound. The executable matrix uses published rc.1, rc.2, rc.3, rc.4 and rc.5. A future version is eligible for this range, but its behavior is not verified until the same checks pass.

Build and pack once, then run the existing tests from physical fixture files against each isolated exact DSH dependency closure:

```sh
npm run build
mkdir -p artifacts
npm pack --ignore-scripts --pack-destination artifacts
npm run test:compatibility
```

The runner checks the installed archive integrity, native entry resolution paths and exact host versions, loads the public package entries, and enables BrowserSkill fixtures with a local runner. It clears NODE_PATH/NODE_OPTIONS. No live profile, browser, credentials or paid provider is needed. The same bytes are used by every host cell. Tests exercise native authorization denial, caller identity, cancellation, completion, Team coexistence, normalized model metadata, unknown shapes and the existing Client contracts.

A separate process creates a real persisted task on rc.1, then rc.5 resumes its parent and the same child with the original snapshot, tools and preset despite a later role override. The runner retains logs, installed fixture resources and upgrade state under .agentdeck-dev/compatibility for inspection, and removes each temporary host closure after its proof to bound disk use. Remove that owned directory after collecting results. --root, --versions and --archive support targeted reproduction. The CI/release gate runs this procedure before preserving the publishable archive. A local pass is not a remote workflow result.

## Recorded baseline

AgentDeck 0.2.4 was exercised with DSH 0.2.2-rc.3, Node.js 24, and BrowserSkill 0.5.0 for the optional browser path. The full local suite passed **173 tests, zero failures and zero skips**. TypeScript checking and package resource validation also passed. This records observed validation, not a promise of compatibility with other DSH releases or model gateways.

The repository's CI runs the source checks and the same-archive five-host matrix with isolated BrowserSkill fixtures. Its workflow badge reports that run separately; a local pass does not imply a remote CI pass.

## Current source verification — 0.2.7 progressive batch setup

AgentDeck 0.2.7 was checked locally against DSH 0.2.2-rc.3 with an isolated BrowserSkill 0.5.0 fixture installation. Client syntax checking, TypeScript checking, the source/client build and package resource validation passed. The full suite reported **251 tests: 244 passed, zero failures and 7 skipped**; the skips are optional BrowserSkill cases unavailable without the installed package/module base. This is a separate source result, not a replacement for the historical 0.2.4 live baseline above.

New checks cover strategy normalization, complete independent candidates and explicit defaults, resource migration, declaration-sensitive no-op detection, minimum/unknown candidate capacities, browser image filtering, conservative scope, progressive controls, exact metadata prefill and stale-consent fencing. AI proposal coverage uses a deterministic stream fixture to verify the selected authorized generator route (with active Session fallback), role responsibilities and constraints reach the prompt, strict JSON becomes a read-only proposal, unavailable generator/candidate routes are rejected, inherited/default and auto entries use the same proposal path, and the accepted proposal still traverses preview/apply preflight. A native authenticated HTTP roundtrip exercises the actual Client controller, Host, isolated JSON storage, an inherited descendant, per-role impact acceptance (including an inherited role named `constructor`) and candidate-to-inherit migration with zero model requests. A partial-save regression proves transient prefix impacts still require acceptance when final resources match, and preserves the actual intermediate state after an injected later-write failure.

The Client panel tests render its real function through a small host-React element recorder; they do not establish DOM layout, visual quality or browser accessibility. Local validation did **not** install this change into an existing GUI/profile or run live-browser checks. Publication is handled separately by the tagged Release workflow, not established by these tests. No paid model calls were made. A bounded independent static review covered the new strategy helper and Host preflight contract; integration and final source verification were performed locally.

## Executable coverage

- Definition/YAML validation, deterministic inheritance and revision identity, cycle/error isolation, schema 1/2 transitions and array/output overrides.
- Context arithmetic, unknown output/window handling, native compaction mechanics and total-input ceilings.
- Candidate pools, Session authorization, output precedence and preservation of selected parameters across cold continuation.
- Real native AgentLoop, private ToolExecutionPipeline delegation, policy/capacity denial, accepted-start reconciliation, completion, cancellation and Agent Teams coexistence.
- Tool masking, exact caller ownership, pinned helper checks, complete instructions/skills, storage durability and serialized save/reset validation.
- Client request planning, cancellation/deadlines, stale-reply fencing, draft preservation, provider/model options and revision-matched readiness display.
- BrowserSkill readiness/configured CLI path, exact child session receipts, normal/cancel/disposal cleanup, including cancellation after successful tool-body execution.

Native harnesses use a deterministic local model adapter. They do not send paid provider requests or establish model-answer quality.

## Observed live checks

The installed plugin was checked in the existing authenticated Harness Web UI: all 16 roles, model/reasoning controls, three independent candidates and their output caps, default selection and candidate limit, task/result views, diagnostics, and light/dark themes. Temporary drafts were discarded and the original theme restored.

A separate opt-in probe used a real independent native child and the public BrowserSkill package against an already paired, verified extension. It opened only its own Agent Window, read the existing Harness page title, rejected another session ID and joined cleanup. The probe used one deterministic local model response and zero paid model calls.

A fresh-load main-frame console capture after site-extension adjustment contained no warnings or errors during the recorded journey. This is not a browser-wide assurance and does not cover workers or unrelated extensions/pages. Raw captures and local Session histories are deliberately excluded from this repository and distributable packages.

## Reproduce

Follow the source setup in the README, then run:

```sh
npm run typecheck
npm test
npm run check:pack
```

When the public BrowserSkill package is available in an isolated prefix or a DSH profile, include its fixture tests:

```sh
AGENTDECK_BROWSER_MODULE_BASE=/path/to/browser-package-prefix npm test
```

The base is a directory containing package.json and resolvable node_modules, not the BrowserSkill module file. Without it, optional BrowserSkill fixtures explicitly skip; other integration checks still run.

The live browser probe is separate from the default suite. Run it only when you intend to open a task-owned Agent Window and the existing Harness page is available at http://127.0.0.1:3080/:

```sh
AGENTDECK_BROWSER_MODULE_BASE=/path/to/browser-package-prefix \
AGENTDECK_BSK_PATH=/path/to/bsk \
node scripts/probe-browser-live.mjs
```

It requires an existing compatible verified connection. It does not start a daemon, pair a device or change trust settings. Normal CI uses fixture runners and does not require a browser, API key or live profile.

## Limits

Static capability availability is distinct from live service connectivity. Parameter validation is distinct from actual prompt assembly. A declared model window is distinct from upstream admission. No matched quality, token-cost or latency advantage over a strong native baseline has been measured or claimed. Model/provider calls and third-party service behavior require their own authorized verification.

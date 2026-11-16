# Verification scope

[English README](../README.md) · [中文说明](../README.zh-CN.md)

## Recorded baseline

AgentDeck 0.2.4 was exercised with DSH 0.2.2-rc.3, Node.js 24, and BrowserSkill 0.5.0 for the optional browser path. The full local suite passed **173 tests, zero failures and zero skips**. TypeScript checking and package resource validation also passed. This records observed validation, not a promise of compatibility with other DSH releases or model gateways.

The repository's CI runs its own checks against the pinned host and an isolated BrowserSkill fixture installation. Its workflow badge reports that run separately; a local pass does not imply a remote CI pass.

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

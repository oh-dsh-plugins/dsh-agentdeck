# DSH AgentDeck

[![DSH plugin](https://img.shields.io/badge/DeepSeek%20Harness-plugin-2563eb)](https://github.com/deepseek-ai/deepseek-harness)
[![DSH compatibility](https://img.shields.io/badge/DSH-0.2.2--rc.3-blue)](package.json)
[![CI](https://github.com/oh-dsh-plugins/dsh-agentdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/oh-dsh-plugins/dsh-agentdeck/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/dsh-agentdeck)](https://www.npmjs.com/package/dsh-agentdeck)

English | [简体中文](README.zh-CN.md)

A third-party plugin for DeepSeek Harness (DSH) that provides ready-to-use scene agents and a native management page. Delegate research, implementation, review and UI verification through DSH's own child-agent lifecycle, with explicit model settings and versioned role definitions.

## Features

- **16 complete agents:** 13 general-purpose roles and three specialist variants, each with instructions, expected inputs, deliverables, skills and tool capabilities.
- **Native delegation:** retain DSH authorization, caller identity, cancellation, persistence, completion notifications and Agent Teams coexistence.
- **Native settings page:** manage agents, tasks/results and diagnostics in English or Simplified Chinese, using the host's light and dark themes.
- **Real model choices:** discover configured providers, model IDs and supported reasoning levels; inherit the parent model, choose a fixed route, or configure up to three inline candidates with a default.
- **Explicit resource settings:** per-role or per-candidate output caps, total-input context budgets, bounded native recovery and clear unknown-capacity diagnostics.
- **Extensible definitions:** derive roles, edit YAML, import/export, reset overrides and add user/project definition directories. Running tasks keep their original snapshots.
- **Scoped tools:** 16 bundled skills and four standard-library helper scripts; browser sessions belong to the exact child that created them.

AgentDeck does not add a classifier model or a separate execution loop. Configured capabilities and model declarations do not grant task authorization or guarantee upstream capacity.

## Requirements

| Component | Supported baseline |
| --- | --- |
| AgentDeck | `0.2.4` |
| DeepSeek Harness | **`0.2.2-rc.3`**; other versions are not claimed compatible |
| Node.js | `>=24.9.0` |
| Development environment | DSH CLI on `PATH`; the host-link helper uses a POSIX shell |
| Optional capabilities | Existing web providers, native tools, or a supported browser integration |

DSH supplies its own peer packages. Do not independently upgrade them inside an active profile to satisfy this plugin.

## Installation

Install the release from npm into a compatible DSH profile:

```sh
dsh plugin --profile web add dsh-agentdeck@0.2.4
```

Use your actual profile name instead of `web`. The DSH plugin manager installs the package and applies its native bundle patch. Restart DSH when the manager requests it, then refresh the existing Harness page.

### GitHub Release archive

Download `dsh-agentdeck-0.2.4.tgz` and `SHA256SUMS` from [GitHub Releases](https://github.com/oh-dsh-plugins/dsh-agentdeck/releases/latest). The `.tgz` asset is the compiled npm installation package; GitHub's automatic source archives do not include the runtime build.

```sh
shasum -a 256 -c SHA256SUMS
dsh plugin --profile web add ./dsh-agentdeck-0.2.4.tgz
```

### Build from source

To build and install a local archive:

```sh
git clone https://github.com/oh-dsh-plugins/dsh-agentdeck.git
cd dsh-agentdeck
npm ci --ignore-scripts
npm run dev:link-host
npm run build
mkdir -p artifacts
npm pack --ignore-scripts --pack-destination artifacts
dsh plugin --profile web add ./artifacts/dsh-agentdeck-0.2.4.tgz
```

Use your actual profile name instead of `web`. `dev:link-host` locates the installed DSH CLI and links its existing public peer packages into this checkout; it does not edit the host or active profile. Set `AGENTDECK_DSH_ROOT` to the installed DSH package directory if the CLI is elsewhere.

Restart DSH when the plugin manager reports that a restart is required, then refresh the existing Harness page. Updating package files alone does not reload every affected module.

## Quick start

1. Open **Settings → AgentDeck**. The page contains **Agents**, **Tasks and results**, and **Diagnostics**.
2. Inspect an agent and, when needed, select a live Session to view its model authorization and effective settings. Selecting a Session does not grant access.
3. Ask the main agent to delegate a bounded task, for example: “Use code-scout to find where this feature is implemented, then use implementer for the authorized change.”
4. Read the native completion notification. Open task details or request paged results only when more evidence is needed.

Known-file edits and short tasks can stay inline. Missing dependencies, disabled roles and invalid explicit role IDs produce diagnostics rather than silently selecting another specialist.

### Included agents

| Agent | Purpose |
| --- | --- |
| `general` | Handle unmatched tasks with read and research capabilities |
| `code-scout` | Locate files, symbols, ownership and call paths |
| `researcher` | Answer bounded questions using primary-source evidence |
| `reader` | Read source material and produce a traceable synthesis |
| `architect` | Compare feasible designs and explain tradeoffs |
| `implementer` | Implement scoped changes and run relevant checks |
| `test-runner` | Run existing checks and preserve their exit status |
| `test-designer` | Design behavioral and failure-boundary tests |
| `debugger` | Reproduce faults and isolate verified causes |
| `reviewer` | Review concrete changes for actionable defects |
| `ui-verifier` | Inspect and exercise the actual interface |
| `data-analyst` | Analyze authorized data with reproducible calculations |
| `docs-writer` | Write documentation from current, verified behavior |
| `security-reviewer` | Review reachable trust-boundary failures |
| `performance-debugger` | Investigate reproducible slow paths with measurements |
| `long-document-reader` | Navigate long sources with a bounded evidence index |

The last three are complete variants. Roles are leaf agents by default. Read-only roles do not receive source-editing, shell, evaluator or further delegation tools. Project checks are a separate execution capability; helpers run existing `test`, `check`, `lint`, `typecheck` scripts and their colon variants without installing dependencies.

### Main-agent tools

| Tool | Behavior |
| --- | --- |
| `scene_agent_catalog` | List/get roles, discover models, preview settings, read compact candidates and task records; model-facing edits may narrow ordinary role settings but cannot change model/resource policy |
| `scene_agent_start` | Start a native child and return its Session ID; omitted role uses `general` |
| `scene_agent_control` | Read status, continue or interrupt a direct child by `childId` |
| `scene_agent_result` | Read evidence and paged output without restarting work |

Native completion arrives asynchronously. AgentDeck child IDs and Agent Teams member names are different namespaces. Inactivity alone does not prove successful completion.

## Customization

The owner settings page supports enable/disable, actual provider/model/reasoning selects, output and input budgets, YAML editing, derivation, import/export and reset. Save conflicts preserve drafts. Changes apply to new starts; running tasks retain their original role, skills, helper revisions and selected model.

Definition precedence is factory defaults → plugin-owned user overrides → configured `customAgentDirs` → the active project's `.dsh/agentdeck` directory. Edit a file-owned role in its source or derive it to a new ID. Broken explicit definitions stay invalid with diagnostics; they do not revert silently to factory content.

```yaml
schemaVersion: 1
id: concise-reviewer
extends: reviewer
title:
  en: Concise reviewer
  zh: 精简审查员
instructions:
  append: |
    Focus on behavioral defects. Return file locations, triggers and fixes.
context:
  targetTokens: 16000
  elasticTokens: 32000
```

Arrays support replacement or `add`/`remove`/`replace`; instructions support `append`/`replace`. Existing version 1 definitions keep their revision identity. Version 2 adds output caps and candidate pools.

### Models, candidates and output

Inherited/fixed roles can set `output.maxTokens` in version 2. Output precedence is role cap → parent effective cap → reported native default. Clearing an inherited override uses `output: null`.

For a small owner-configured candidate pool:

```yaml
schemaVersion: 2
id: bounded-reader
extends: reader
model:
  mode: auto
  defaultCandidate: normal
  candidates:
    - id: normal
      purpose: Bounded reading and synthesis
      provider: your-provider
      model: your-authorized-model
      reasoning:
        mode: model-default
      maxTokens: 4096
reasoning:
  mode: model-default
```

Replace the route with an actual configured, authorized provider/model pair. Each pool has one to three candidates and one default; each candidate owns its output and reasoning setting. Read `scene_agent_catalog` with `action: candidates` and the role ID, then pass the returned `revision` and optionally `candidateId`/`candidateReason` to `scene_agent_start`. An omitted candidate selects the default. Stale, invalid or unauthorized choices fail before startup and do not try another model.

Provider/model IDs and reasoning levels come from host adapters. Model discovery, Session authorization, parameter validation and actual prompt admission are separate checks. Unknown output/window values remain unknown. Output caps are per request, not monetary or cumulative usage budgets.

### Plugin options

The native plugin settings expose:

```yaml
customAgentDirs: []
projectConfigDirectory: .dsh/agentdeck
allowNativeFallback: true
```

Guarded fallback applies only to the unchanged factory `general`, before any delegation, when its full composition cannot load. It retains the role's instructions, leaf guard, skills, model/output policy and isolated compaction in a persisted minimal native preset. Optional tools may be missing and are reported. It never retries native policy/capacity denials, uncertain starts or an already accepted child.

## Context recovery and browser support

Target and elastic budgets count **all input per request**, including instructions, tools, skills, history and pending material. A known context window is reduced by output reservation and an adaptive margin. Fixed prompt/tool cost is measured in the child; the UI does not promise free material capacity before assembly.

Each snapshot configures native isolated compaction and bounded overflow recovery. Host compression integrations may override native policy; AgentDeck does not bypass them or add a second compressor. Irreparable input fails with a diagnostic instead of retrying the unchanged task.

Browser roles select one admitted backend before their first model request:

- **BrowserSkill:** activate the public skill, read the unique active plugin's configured CLI path, and run a five-second read-only status check. A responsive compatible extension, Required local verification and a paired device are required. AgentDeck does not start a daemon or alter pairing. Explicit sessions must belong to the exact child; normal completion, cancellation and disposal close only its recorded sessions through the native pipeline.
- **MCP:** a complete supported namespace supplies finite observation/interaction tools. Native execution checks live connectivity; scripts, injected headers, debug/rule/replay paths and transfers are rejected. Page creation is excluded and closing requires an owned receipt.

BrowserSkill `0.5.0` was used for the recorded live proof. Ordinary role lists remain cheap/static; browser-role previews perform the bounded check. Computer Use's script interface is not adapted. Required browser and web services must already be available in DSH.

## Data and removal

AgentDeck stores user overrides, immutable role/skill snapshots, helper hashes and startup receipts in the native `dsh_agentdeck` storage domain. Task descriptions, selected routes and optional selection reasons can be part of those records. Native Session logs remain the execution record and can contain delegated material and results.

There is no AgentDeck analytics service, classifier endpoint or separate credential store. Delegated model requests use the configured DSH provider; web/browser operations use the installed host services. Their existing data handling still applies.

Disabling or removing the bundle withdraws its tools and management page. It does not delete native conversations, project definitions or durable plugin records; removal is not data erasure. Preserve the supported snapshot dependencies if you need to resume existing tasks.

## Development and verification

After installing dependencies and linking the matching DSH host:

```sh
npm run typecheck
npm test
npm run check:pack
```

The recorded full suite passed **173 tests** on the pinned baseline, including native delegation, denial, cancellation, cold continuation, Team coexistence, atomic configuration updates and browser ownership. BrowserSkill fixture tests are opt-in when that public package is available. A separate live independent-child probe verified its own window and cleanup with a deterministic local model response and zero paid model calls.

See [verification scope](docs/validation.md), [contributing](CONTRIBUTING.md), [core contract](docs/core-contract.md), [Client/Host contract](docs/ui-contract.md) and [changelog](CHANGELOG.md). Tests and UI checks do not establish model quality or token/cost/latency improvements against a strong native baseline.

## Automated releases

Pull requests and pushes to `main` run CI. Pushing a matching `vX.Y.Z` tag runs the full checks, publishes the tested archive to npm through Trusted Publishing, verifies its public bytes, and creates a GitHub Release with the `.tgz` and checksums. Stable releases use npm `latest`; prereleases use `next`. Package maintainers must complete the one-time npm trusted publisher setup described in the [bilingual release guide](docs/releasing.md).

## Security and license

Report vulnerabilities using the [security policy](SECURITY.md). For ordinary bugs or feature requests, use [GitHub Issues](https://github.com/oh-dsh-plugins/dsh-agentdeck/issues) and remove credentials, private paths and Session content from examples.

[MIT](LICENSE). See [third-party notices](THIRD_PARTY_NOTICES.md). Independently maintained; not affiliated with DeepSeek or OpenAI.

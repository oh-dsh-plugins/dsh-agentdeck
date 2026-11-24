# DSH AgentDeck

[![DSH plugin](https://img.shields.io/badge/DeepSeek%20Harness-plugin-2563eb)](https://github.com/deepseek-ai/deepseek-harness)
[![DSH compatibility](https://img.shields.io/badge/DSH-%3E%3D0.2.2--rc.1-blue)](package.json)
[![CI](https://github.com/oh-dsh-plugins/dsh-agentdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/oh-dsh-plugins/dsh-agentdeck/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/dsh-agentdeck)](https://www.npmjs.com/package/dsh-agentdeck)

English | [简体中文](README.zh-CN.md)

A third-party plugin for DeepSeek Harness (DSH) that provides ready-to-use scene agents and a native management page. Delegate research, implementation, review and UI verification through DSH's own child-agent lifecycle, with explicit model settings and versioned role definitions.

## Features

- **16 complete agents:** 13 general-purpose roles and three specialist variants, each with instructions, expected inputs, deliverables, skills and tool capabilities.
- **Native delegation:** retain DSH authorization, caller identity, cancellation, persistence, completion notifications and Agent Teams coexistence.
- **Native settings page:** manage agents, tasks/results and diagnostics in English or Simplified Chinese, using the host's light and dark themes.
- **Real model choices:** discover configured providers, models and reasoning levels; inherit, select a fixed route or use a candidate pool with a default.
- **Per-role AI suggestions:** choose an independent generator and adopt model/reasoning settings into a draft; new tasks inherit native context recovery without separate quotas.
- **Extensible definitions:** derive roles, edit YAML, import/export, reset overrides and add user/project definition directories. Running tasks keep their original snapshots.
- **Scoped tools:** 16 bundled skills and four standard-library helper scripts; browser sessions belong to the exact child that created them.

AgentDeck does not add a classifier model or a separate execution loop. Configured capabilities and model declarations do not grant task authorization or guarantee upstream capacity.

## Requirements

| Component | Supported baseline |
| --- | --- |
| AgentDeck | `0.3.2` |
| DeepSeek Harness (source build) | `0.2.2-rc.1` through `rc.5`, plus `0.2.3-alpha.2` as exact release targets |
| Node.js | `>=24.9.0` for the plugin. DSH `0.2.3-alpha.2` requires `^24.22.3 || >=26.13.1`. |
| Development environment | DSH CLI on `PATH`; the host-link helper uses a POSIX shell |
| Optional capabilities | Existing web providers, native tools, or a supported browser integration |

DSH supplies its own peer packages. Do not independently upgrade them inside an active profile to satisfy this plugin.

## Installation

For local acceptance before publication, install the archive from [Build from source](#build-from-source) into a test profile. Use the archive path to select the build under test.

Once this version is published, install it from npm:

```sh
dsh plugin --profile web add dsh-agentdeck@0.3.2
```

Use your actual profile name instead of `web`. The DSH plugin manager installs the package and applies its native bundle patch. Restart DSH when the manager requests it, then refresh the existing Harness page.

### Upgrade DSH from RC to Alpha

1. Let active tasks settle on RC and pause new work. Install the local AgentDeck archive while the profile is still on RC.
2. Restart the same RC Web profile and leave the parent Sessions unopened. Go directly to **AgentDeck → Diagnostics → Record workspaces for the DSH upgrade**. Resolve any pending items on RC, then restart and record again. A stopped Session can still be resident until DSH restarts.
3. Once the recording reports zero pending items, stop RC with the Sessions still unopened. Preserve an isolated copy of its profile and Session storage, along with the referenced workspace paths. Then open the working profile on Alpha.

On Alpha, each new child inherits the calling Session's workspace. Select a Session already in the intended workspace to delegate there. Explicit model selections use the current DSH Host setting. An RC child can resume on Alpha only with a matching workspace record and effective native directory. For a paused legacy child, use the isolated RC copy with the original workspace to recover it. Alpha writes workspace events that older DSH readers cannot open. Keep the post-upgrade data separately.

### GitHub Release archive

Download `dsh-agentdeck-0.3.2.tgz` and `SHA256SUMS` from [GitHub Releases](https://github.com/oh-dsh-plugins/dsh-agentdeck/releases/latest). The `.tgz` asset is the compiled npm installation package; GitHub's automatic source archives do not include the runtime build.

```sh
shasum -a 256 -c SHA256SUMS
dsh plugin --profile web add ./dsh-agentdeck-0.3.2.tgz
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
dsh plugin --profile web add ./artifacts/dsh-agentdeck-0.3.2.tgz
```

Use your actual profile name instead of `web`. `dev:link-host` locates the installed DSH CLI and links its existing public peer packages into this checkout; it does not edit the host or active profile. Set `AGENTDECK_DSH_ROOT` to the installed DSH package directory if the CLI is elsewhere.

Restart DSH when the plugin manager reports that a restart is required, then refresh the existing Harness page. Updating package files alone does not reload every affected module.

## Quick start

1. Open **Settings → AgentDeck**. The page contains **Agents**, **Tasks and results**, and **Diagnostics**.
2. Inspect an agent and, when needed, select a live Session to view its model authorization and effective settings. Selecting a Session does not grant access.
3. Ask the main agent to delegate a bounded task, for example: “Use code-scout to find where this feature is implemented, then use implementer for the authorized change.”
4. Read the native completion notification. Open task details or request paged results only when more evidence is needed.

Known-file edits and short tasks can stay inline. Missing dependencies, disabled roles and invalid explicit role IDs produce diagnostics rather than silently selecting another specialist.

### Move model settings between machines

In **Settings → AgentDeck → Agents**, choose **Export model settings** and select the roles to include. The JSON file contains saved model modes, reasoning settings, candidate IDs, purposes, ordering and defaults. It does not include provider connections, credentials, paths, instructions or skills. Unsaved drafts are not exported.

On the other machine, leave **Session context** unselected and choose **Import model settings**. Review each destination role and map missing providers, models or unsupported reasoning efforts to local choices. Uncheck roles to skip them, or skip individual candidates while keeping at least one and explicitly choosing a replacement before removing the default. Inherited settings follow the destination machine's configuration. Missing role IDs require an explicit destination; source-owned roles must be edited at their source.

Choose **Preview changes**, review the before/after configuration, then **Stage drafts**. Save each role through its normal Save button; current revisions and inheritance impacts are checked again. Existing unsaved drafts are protected. The file transfers preferences and does not grant model authorization.

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
| `scene_agent_catalog` | List/get roles, discover models, preview settings, read compact candidates and task records; save and reset are available on the owner management page |
| `scene_agent_start` | Start a native child and return its Session ID; omitted role uses `general` |
| `scene_agent_control` | Read status, continue or interrupt a direct child by `childId` |
| `scene_agent_result` | Read evidence and paged output. For later pages pass `nextOffset` as `offset` and include `resultRevision` |

Native completion arrives asynchronously. AgentDeck child IDs and Agent Teams member names are different namespaces. Inactivity alone does not prove successful completion.

## Customization

The owner settings page supports enable/disable, actual provider/model/reasoning choices, YAML editing, derivation, import/export and reset. Fixed and candidate modes offer AI suggestions inside each role editor. Choose the generator independently without selecting a Session; adopting changes only the draft until normal Save. Running tasks retain their original snapshots.

Suggestions explain routes, reasoning, candidate purposes and defaults in the current mode, with before/after values. They do not batch-edit other roles. Failures expose the stage and actual cause, with expandable raw response; stale results cannot be adopted. See the [Client and Host contract](docs/ui-contract.md).

Definition precedence is factory defaults → plugin-owned user overrides → configured `customAgentDirs` → the active project's `.dsh/agentdeck` directory. Edit a file-owned role in its source or derive it to a new ID. Broken explicit definitions stay invalid with diagnostics; they do not revert silently to factory content.

```yaml
schemaVersion: 3
id: concise-reviewer
extends: reviewer
title:
  en: Concise reviewer
  zh: 精简审查员
instructions:
  append: |
    Focus on behavioral defects. Return file locations, triggers and fixes.
```

Arrays support replacement or `add`/`remove`/`replace`; instructions support `append`/`replace`. Version 1/2 sources remain readable and normalize to version 3 for new tasks, without retired output/context quotas. Reads never rewrite source files; historical execution snapshots retain their original policy.

### Models and candidates

Roles use native model parameter inheritance and host context recovery. AgentDeck does not configure output caps, target/elastic input budgets or resource migration when leaving candidate mode. Switching to fixed seeds the default candidate; switching to inherit restores native inheritance. All edits enter the draft first.

For a small owner-configured candidate pool:

```yaml
schemaVersion: 3
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
reasoning:
  mode: model-default
```

Use actual configured, authorized provider/model routes. A pool needs at least one candidate and a default; each candidate has a purpose and reasoning setting. Read `scene_agent_catalog` with `action: candidates` and the role ID, then pass its `revision` and optional `candidateId`/`candidateReason` to `scene_agent_start`. An omitted candidate selects the default. Stale, invalid or unauthorized choices fail before native startup without trying another route.

Model directories and optional metadata inform the UI and do not pre-gate AI generation. The selected generator is actually called; failures preserve their cause and response. Child execution still uses native model authorization and parameter validation. Unknown model windows remain unknown.

### Plugin options

The native plugin settings expose:

```yaml
customAgentDirs: []
projectConfigDirectory: .dsh/agentdeck
allowNativeFallback: true
```

Guarded fallback applies only to the unchanged factory general before delegation when its full composition cannot load. Its persisted minimal native preset retains instructions, leaf guard, skills, model settings and host recovery inheritance. Missing optional tools are reported. It never retries native denials, uncertain starts or an accepted child.

## Context recovery and browser support

New tasks have no separate role input or output quota. Actual windows and parameters follow native model selection and inheritance, while automatic compaction uses the existing host service. Historical policyVersion: 1 snapshots restore their original limits; new tasks use resource-free policyVersion: 2.

Native recovery can compact history before a request and reduce history after a standard provider overflow before retrying the current request, preserving the same child and completed tool results. Irreducible fixed input can still fail. Output cutoff retains text and reports partial completion, allowing continuation in the same child.

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

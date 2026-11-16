---
name: project-checks
description: Discover and run existing project checks, retain real exit status, and report missing prerequisites without installing them.
---

# Project checks

Use to execute tests, type checks, lint or builds that already belong to the project. Execution capability does not itself authorize a command with external or destructive effects.

1. Read the project instructions and script definitions. Inspect relevant pre/post lifecycle scripts and the effective command before executing. Confirm the working directory, environment and expected local side effects.
2. Select the narrow check that observes the changed behavior, followed by broader checks required by the project. Establish that existing dependencies and required services are available. If they are missing, report the prerequisite; do not run install commands or package download wrappers.
3. Run the command and preserve its exit status. A process starting, producing a log or creating a file is not proof it completed successfully. Track any background job until its relevant result is collected or it is canceled.
4. Classify failures as behavioral, compile-time, environment-related or canceled. Read the smallest useful error excerpt and relevant context. Rerun only after an input changed or to investigate a plausible intermittent failure.
5. Return executed commands, outcomes and material skipped checks. Separate static inspection from runtime evidence.

The helper `assets/scripts/project-checks.mjs` lists scripts by default: `node <package>/assets/scripts/project-checks.mjs <root>`. To run one existing script use `<root> --run <name> [-- <arguments...>]`. It uses the declared existing package manager without a download wrapper, checks local dependency availability, refuses install commands in the selected lifecycle chain, and sets offline environment flags. Review arbitrary project scripts before execution; static checks cannot prove they have no network or data effects. The helper never invokes installation to repair an environment.

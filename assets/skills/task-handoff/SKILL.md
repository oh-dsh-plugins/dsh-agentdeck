---
name: task-handoff
description: Preserve authorization, bound delegated work, and return an evidence-backed result that another agent can continue.
---

# Task handoff

Use this skill at the beginning and end of a delegated task, and before supported context recovery. The goal is a complete result with enough retained state to avoid repeating work.

1. Restate the desired outcome in working notes. Identify authorized actions, owned paths, dependencies and acceptance checks. Treat capabilities as availability, not permission. Parent restrictions do not automatically configure child restrictions; retain the restrictions explicitly supplied with this task.
2. Read the relevant instructions and source contracts. Locate only the material needed for the current decision. Mark unknown facts instead of filling them with assumptions.
3. Carry out the authorized work. Keep a small evidence ledger: source locations, decisions, changed files, actual command results and unresolved requirements. Record identifiers needed for supported cancellation or continuation; do not invent another agent's state.
4. Before context is exhausted, preserve the objective, restrictions, current definition revision, completed work, exact source anchors and next action. Use the native recovery path. A summary is a navigation aid, not a substitute for rechecking decisive source material.
5. Return the result first, followed by evidence and material limits. For implementation, name the delivered behavior and checks actually run. For investigation, separate supported findings from hypotheses. For a blocker, name the missing input or capability and precise unblock condition.

Do not mark a task complete while required work is still a placeholder. Do not publish, install, send external messages or broaden authorization merely to make the handoff look complete. Keep the final report concise enough for the parent to use directly, with retrievable paths instead of raw logs.

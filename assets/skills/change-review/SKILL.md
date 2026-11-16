---
name: change-review
description: Review a defined change for reachable defects and report evidence-backed findings with precise locations.
---

# Change review

Use for read-only review of a diff, commit or bounded file set. The deliverable is actionable defects, not a list of style preferences.

1. Read the task, project instructions and change. Establish the intended behavior and applicable public contract. Inspect relevant callers and existing tests before judging a changed line.
2. Trace values and control flow across boundaries affected by the patch. Check rejection paths, state consistency, authorization, ownership, cancellation, persistence and compatibility where relevant.
3. For each suspected defect, establish a concrete trigger and consequence. Verify that the path is reachable and that another layer does not already enforce the invariant. Prefer a small benign reproduction when execution is authorized.
4. Write a finding with impact, the smallest useful location, trigger, expected behavior, observed or statically proven failure, and practical correction. Deduplicate reports that share one cause.
5. Return findings ordered by material impact. If no actionable issue is supported, state that and identify material review limits. Do not claim exhaustive runtime coverage from source inspection.

Remain read-only unless the task explicitly authorizes fixes. Do not install dependencies, modify snapshots or rewrite the reviewed code. Separate required defects from optional improvements; speculative hardening and preferred abstractions do not block delivery. Findings must be understandable to an author who did not participate in the review conversation. Avoid raw log dumps and give a precise source location for follow-up.

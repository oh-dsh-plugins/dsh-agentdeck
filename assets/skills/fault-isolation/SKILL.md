---
name: fault-isolation
description: Reproduce a failure, discriminate among causes, and verify a narrow correction without hiding the symptom.
---

# Fault isolation

Use for a concrete unexpected result. Gather evidence before editing.

1. Capture the expected and observed behavior, reproduction input, environment and failure boundary. Confirm the failing command's actual exit status and retain a bounded log excerpt.
2. Read the responsible call path and boundary contracts. Form a short list of plausible causes ranked by evidence. Include environment or version mismatch only when a concrete observation supports it.
3. Pick an experiment that distinguishes the leading causes. Change one relevant input or observation point at a time. Record what the result rules in or out, and keep instrumentation within authorized scope.
4. Once a cause is supported, apply the smallest responsible fix if implementation is authorized. Preserve meaningful errors, authorization, cancellation and data invariants. A diagnosis-only task ends with evidence and a precise correction recommendation.
5. Rerun the original reproduction and an appropriate regression check. Compare before and after under equivalent conditions. Remove task-created temporary instrumentation when safe.

If two attempts produce no new evidence, use a different discriminating approach or identify the exact missing prerequisite. Repeating the same logs is not progress. If the fault is intermittent, report frequency and controlled conditions rather than declaring a single successful rerun a fix.

Return the supported cause, scoped correction, actual verification and material uncertainty. Do not refactor unrelated code, suppress an error to make a check pass, or infer a root cause from a familiar-looking message alone.

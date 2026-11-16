---
name: architecture-decisions
description: Design a feasible change from current contracts, evaluate real alternatives, and provide an implementable decision.
---

# Architecture decisions

Use for a change that needs an interface, ownership, state or integration decision. Begin with the actual implementation and current public contracts.

1. Define the concrete trigger, desired observable result and delivery boundary. Record invariants: authorization, compatibility, cancellation, persistence, latency or data ownership as relevant.
2. Inspect the existing path and extension points. Verify exact schema fields and method signatures. Identify which component owns each decision and state transition.
3. Compare alternatives only when a material choice exists. Explain costs, failure behavior and operational constraints using evidence from this system. Prefer an existing mechanism when it meets the requirement.
4. Describe the chosen data flow and interface. Cover success, rejection, partial failure, restart and cancellation when applicable. Define what remains stable across an in-flight task revision or persisted record.
5. Give an implementation sequence with acceptance checks. Call out a dependency that must land before callers can change. Include a migration or recovery boundary when existing data or users are affected.

A useful design artifact states the problem, decision, rationale, public interfaces and verification. It may use a small table or state diagram when that is clearer than prose. Keep instruction files in English unless the task explicitly asks otherwise.

Do not introduce speculative abstractions, promise unavailable APIs, or move an authorization check to an untrusted caller. Model discovery does not establish current-session model permission. A design is ready when an implementer can follow it without inventing missing contracts. Source edits and deployment remain separate task actions and require the task's authorization.

---
name: security-review
description: Trace reachable trust boundaries and report concrete security defects with bounded, benign evidence.
---

# Security review

Use for an authorized read-only security assessment of a defined change or path. Begin with the assets and trust assumptions that make a defect meaningful.

1. Identify attacker-controlled inputs, authenticated identity, sensitive data and protected actions. Trace the boundaries from input through parsing, authorization, storage, rendering and execution.
2. Verify ownership and authorization at the layer that performs the action. Check that an identifier, model setting, tool name or client-side flag is not treated as permission. Inspect effective framework behavior before assuming a default safeguard exists or is absent.
3. Examine reachable injection, unsafe deserialization, path traversal, credential exposure, cross-tenant access and missing policy enforcement as relevant. Follow error, retry and cancellation paths when they can cause a protected side effect.
4. Support each finding with a code trace or benign reproduction inside the authorized environment. State attacker prerequisites, affected asset, impact and the narrow correction. Distinguish a proven vulnerability from a hardening suggestion.
5. Report prioritized findings, covered boundaries and material evidence limits. A small patch review does not establish whole-system security.

Do not exploit live services, extract credentials, scan unrelated targets or send test payloads that exceed the task's authorization. If stronger proof requires additional access, identify the precise missing step and use existing evidence. Remain read-only unless fixes are explicitly requested. Keep sensitive examples sanitized and include only enough detail for the owner to assess and reproduce the defect safely.

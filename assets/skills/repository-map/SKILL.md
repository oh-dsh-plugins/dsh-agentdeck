---
name: repository-map
description: Locate a behavior's entry point, ownership boundary, callers and checks with a compact source map.
---

# Repository mapping

Use when an implementation or review needs precise code locations. The output is a navigation map grounded in real references, not a general repository tour.

1. Read repository instructions and inspect the top-level source layout. Use path search for named modules, then content search for symbols, routes or exact error text.
2. Open the relevant file with a bounded amount of adjacent context. Follow the real call path from entry point to the state change or returned result. Confirm imports and registration sites so an unused module is not mistaken for active behavior.
3. Inspect the public type or schema at each important boundary. Find representative callers and existing tests. Record where authorization, cancellation, persistence or error conversion occurs if the task touches those concerns.
4. Identify the smallest extension or edit point and an existing pattern that can be copied. Note generated or upstream-owned files that should not be edited.
5. Return a short ordered map: path and location, responsibility, callers, relevant checks, and remaining uncertainty. Include enough context that the next agent can begin from these locations without repeating the search.

The optional helper `assets/scripts/repository-map.mjs` prints a bounded file inventory using Node standard APIs. Run it with `node <package>/assets/scripts/repository-map.mjs <root> [--limit N]`. It skips dependency and version-control directories and does not modify files. Inspect actual file contents separately; a filename alone does not prove behavior.

Stop when the required boundary is established. Avoid dumping source trees, searching unrelated subsystems, executing project scripts or making opportunistic fixes during read-only discovery.

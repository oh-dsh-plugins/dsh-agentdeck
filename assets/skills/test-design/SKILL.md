---
name: test-design
description: Turn behavioral requirements and failure boundaries into deterministic tests with observable assertions.
---

# Test design

Use when test coverage must demonstrate a meaningful behavior or regression. Start from the contract, not the implementation's internal structure.

1. Read requirements, callers and existing tests. Identify the observable output or state change and the smallest test level that can verify it. Avoid a mock that removes the property under test.
2. Build a compact case matrix: representative success, invalid input, just-inside and just-outside limits, dependent failure, repeated operation and cancellation when relevant. Focus on boundaries the change can affect.
3. Choose deterministic fixtures. State their grain and assumptions; keep secrets and real personal records out. Control time, random seeds and asynchronous completion explicitly where needed.
4. Assert behavior and failure semantics. Check that a rejected operation did not perform its protected side effect, and that unrelated records remain usable when isolation is part of the contract.
5. Implement only within authorized test paths, use the current framework, and execute the targeted cases. For a regression, demonstrate failure before the fix when practical. Report the actual result and material coverage gaps.

Tests should explain why the requirement matters and fail for a meaningful defect. Avoid snapshots or assertions that merely copy a constant or private function body. Do not update a failing snapshot until the changed behavior has been assessed. Do not install dependencies silently or modify unrelated production code to make the suite green. Once relevant cases and required checks pass, stop expanding coverage unless a new failure or unresolved risk justifies another case.

---
name: browser-verification
description: Verify a real application's visible journeys, accessibility and state transitions using browser evidence.
---

# Browser verification

Use when the task requires proof of what users can see or do. Start at the existing application URL and verify the destination before interaction.

1. Read the requested journey, expected behavior and authorized actions. Inspect the current page with an accessible snapshot. Identify starting state, user identity if relevant, and test data.
2. Exercise the shortest normal journey. Use named controls from the current snapshot, fill forms together where supported, and verify the visible state after each important action. A submitted request is not proof that the operation succeeded.
3. Check relevant empty, loading, validation, failure and disabled states. Inspect keyboard navigation, labels, focus, overflow and required viewport sizes. Use screenshots for visual judgments; a DOM snapshot alone does not prove visual quality.
4. For an observed defect, record route, viewport, starting state, steps, expected result and actual result. Include focused console or network evidence only when it explains the failure.
5. Restore test-created state when authorized and safe. Report exercised journeys and environments, failures and material unverified paths.

Do not start a replacement server, use a mock interface as evidence for the installed application, or perform purchases, external communication or destructive operations beyond task authorization. Read-only inspection can continue when an action is out of scope. Preserve existing user data and signed-in state. If browser access is unavailable, state the exact limitation and provide static findings separately; do not claim the interface was exercised.

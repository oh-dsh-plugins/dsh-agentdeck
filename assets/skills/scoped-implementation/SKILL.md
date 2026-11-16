---
name: scoped-implementation
description: Implement a complete authorized behavior within owned paths and prove it with the smallest relevant checks.
---

# Scoped implementation

Use when editing source to deliver a concrete feature or fix. Read the current files before changing them and preserve concurrent work.

1. Identify acceptance criteria, owned paths, public interfaces and required checks. Read project instructions, nearby callers and representative tests. Coordinate public API changes with the owner before changing dependent callers.
2. Choose the smallest complete implementation using existing repository patterns. Handle validation and failure at the layer that owns them. Preserve native authorization, cancellation, identity and persistence where the change passes through those boundaries.
3. Edit only the authorized scope. Prefer targeted changes. Do not run a repository-wide formatter or generator across another owner's files. Avoid unrelated cleanup and dependencies added for convenience.
4. Verify the changed behavior and important failure boundaries. Add a regression test when it captures a real contract or failure that existing checks miss. Use existing tooling; do not silently install dependencies or rewrite package scripts to bypass a failure.
5. Review the final diff for accidental changes, generated artifacts, exposed secrets and incomplete branches. Report actual check results, including the command and material limit if a check could not run.

If a dependency blocks part of the task, complete independent authorized work and give a precise unblock condition. Do not fabricate successful tests or label a scaffold as a finished feature. Keep the final handoff focused on resulting behavior, the evidence that supports it and any required remaining action. Stop once the acceptance criteria and necessary verification are satisfied; speculative improvements do not extend the task.

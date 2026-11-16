---
name: long-document-reading
description: Read material larger than one context using a source manifest, evidence index and recoverable coverage notes.
---

# Long document reading

Use when a document collection cannot be loaded faithfully in one context. Bounded reading should preserve source meaning and make omissions visible.

1. Build a manifest with document names, versions, headings and stable locations. Translate the requested questions into an evidence index and a coverage requirement. Distinguish exhaustive reading from targeted retrieval.
2. Read bounded sections with adjacent context. Record supported claims, qualifications and contradictions with exact anchors. An outline or search hit does not count as reading the underlying passage.
3. Maintain compact recovery notes: objective, constraints, definition revision where relevant, completed coverage, claim-to-source index, open questions and next locations. Mark summaries and excerpts as partial.
4. Before the effective input budget is exhausted, use supported native recovery. Preserve the evidence index rather than replaying all raw text. A configured context request does not establish the model's actual safe capacity; leave room for output and fixed instructions.
5. Revisit original passages for decisive claims. Reconcile terminology, dates and revisions across documents. Return a cited synthesis, navigation index and honest coverage statement.

Use `assets/scripts/document-outline.mjs` for local text navigation when useful: `node <package>/assets/scripts/document-outline.mjs <file> [--limit N]`. It does not read every section for you and cannot interpret PDF or Office documents.

Never report exhaustive coverage when required sections remain unread. If a source is missing or truncated, identify it and explain which conclusion is affected. Keep the parent handoff bounded, with exact retrieval locations for deeper review.

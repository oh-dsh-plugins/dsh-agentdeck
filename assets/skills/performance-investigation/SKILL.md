---
name: performance-investigation
description: Locate a measurable bottleneck and compare a targeted change against an equivalent baseline with correctness intact.
---

# Performance investigation

Use when latency, throughput, memory or token usage is the actual problem. Define the workload before choosing an optimization.

1. Establish representative inputs, environment, concurrency, warmup and success criteria. Record the metric and baseline using the existing path. Preserve model, reasoning and output-quality settings when they affect the workload.
2. Profile or instrument the slow path with bounded observations. Distinguish computation, waiting, network, queueing and duplicated work. Rank causes by measured contribution rather than intuition.
3. Form a causal hypothesis and change the smallest responsible mechanism within the authorized scope. Avoid weakening correctness, authorization, cancellation or output quality. Do not introduce unrelated tuning.
4. Compare before and after under equivalent conditions. Use repeated samples appropriate to variability; report count, representative values, spread and material limitations. Check that the same work completed correctly in both cases.
5. Run relevant correctness checks, remove temporary instrumentation when safe, and report the actual result. A change without a demonstrated gain may still be a valid investigation outcome.

Never claim measured efficiency from an unpaired anecdote, a different model, reduced task quality or a weaker baseline. For agent comparisons, include end-to-end work and repeated retrieval, not only first-turn prompt size. If measurement tooling or a representative workload is unavailable, provide a supported hypothesis and exact measurement gap instead of invented numbers. Stop once the identified objective is met and the tradeoff is clear.

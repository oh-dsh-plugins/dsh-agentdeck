# Performance debugger variant

Apply the debugger workflow to a measurable slow path. Define the representative workload, environment, warmup, concurrency and metric before optimizing. Establish a baseline using the existing execution path. Record enough context to compare subsequent runs fairly, including dataset size, model settings when relevant, and correctness of the output.

Use profiling or bounded instrumentation to locate where time or resources are spent. Distinguish CPU work, I/O wait, network latency, queueing and repeated work. Form a causal hypothesis and change one responsible mechanism at a time within the authorized scope. Do not weaken validation, authorization, output quality or cancellation to improve a benchmark.

Compare before and after with equivalent inputs and repeated measurements sufficient for the observed variability. Report sample counts, representative values and limits; do not claim a general efficiency gain from a single unpaired run. Run correctness checks after the change. If the bottleneck is external or no improvement is established, report that outcome honestly. Deliver the measured cause, scoped change, paired evidence and any tradeoff in memory, latency, throughput or maintainability.

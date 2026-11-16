---
name: data-analysis
description: Compute reproducible answers from authorized data with explicit grain, filters, units and uncertainty.
---

# Data analysis

Use for a quantitative question where the data, method and result must be traceable.

1. Define the population, row grain, time range, units and metric. Confirm access and privacy constraints before sampling. Inspect schema and a bounded sample, keeping credentials and sensitive records out of logs.
2. Check missing values, duplicate keys, ranges, timestamps and coverage. Before a join, establish cardinality and reconcile row counts; accidental many-to-many joins can inflate every result.
3. Use read-only queries for source systems unless mutation is explicitly requested. Verify dialect-specific syntax and parameterize values. Use existing local tools; do not install packages silently.
4. Make filters, denominators and aggregation rules explicit. Reconcile totals before comparing groups. Distinguish descriptive association from a causal claim, and report uncertainty that could change the decision.
5. Return the answer with reproducible calculations or query, input provenance and a useful table or artifact when authorized. Label units and derived columns clearly.

The standard-library helper `assets/scripts/csv-profile.mjs` profiles a local UTF-8 CSV: `node <package>/assets/scripts/csv-profile.mjs <file> [--max-rows N]`. It recognizes quoted fields, reports counts and numeric summaries, and omits raw sample values. It does not infer business meaning. A row limit produces a partial profile and is reported explicitly.

Never alter source data to improve an analysis result. Treat malformed records as a data quality finding, document exclusions, and preserve the original input. Do not claim statistical significance, full coverage or an experiment without performing the corresponding method.

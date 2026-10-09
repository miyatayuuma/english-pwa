# English PWA — Vocabulary Single-Entry Nuance Qualifier Audit

## Final closure

- Status: **CLOSED**; unresolved cross-audit authority issues are reviewed, isolated, and excluded from production remediation.
- Repository: `miyatayuuma/english-pwa`; canonical branch: `audit/vocabulary-single-entry-nuance-qualifier`.
- Current main: `794e6cf8c88ed6775be9b56a6f1fddc0775a7130`.
- Immutable parallel semantic review base: `2d60188baaceaf77c4e3370ebb37029c48201e2e`.
- Source population: **2,478**.
- Learning-eligible population: **2,477**; excluded from learning: **1** (`vocab:00947`, toil). The source record remains in the audit population.

## Coverage and status

| Metric | Count |
|---|---:|
| Base reviewed authority preserved | 494 |
| Parallel distinct reviewed IDs | 1,984 |
| Total reviewed | 2,478 |
| Unreviewed / pending / stale / missing | 0 |
| Source order drift / unknown IDs / unresolved duplicate reviews | 0 |
| REVIEWED | 2272 |
| PREVIOUS_AUTHORITY_CONFIRMED | 104 |
| UPSTREAM_ISOLATED | 94 |
| CROSS_AUDIT_CONFLICT (reviewed, isolated) | 8 |

## Decision accounting

| Decision | Count |
|---|---:|
| KEEP | 1824 |
| QUALIFIER_ONLY | 56 |
| QUALIFIER_AND_PARAPHRASE | 297 |
| PARAPHRASE_REVALIDATION_ONLY | 199 |
| UPSTREAM_AUTHORITY_REVIEW | 94 |
| CROSS_AUDIT_CONFLICT (unresolved, isolated) | 8 |

## Authority changes and confidence

- Qualifier additions: **353**; rewrites: **0**; removals: **0**.
- Paraphrase removals: **671**; additions: **8**.
- Confidence: HIGH **2080**, MEDIUM **365**, LOW **33**.
- Previous Near-Synonym authority confirmed: **104**.
- Current-main entries revalidated: **1** (`vocab:00139`); remaining stale: **0**. Current main semantic field comparison found one relevant entry change since the fixed source, already revalidated.
- Worker judgments: **1,983 raw / 1,981 distinct IDs**; Boundary Repair: **3**; Aggregator-adjudicated: **1**.
- Production remediation candidates: **551**. Production-excluded candidates: **1** (`vocab:00947`, learning-ineligible). LOW-confidence candidates: **0**. All candidates remain marked not materialized.

## Duplicate and boundary handling

- `vocab:00762`: W02/W03 conflict independently adjudicated **KEEP**; keep `reasonable` and `respectable` for the fixed wages sense and occurrence. Full evidence and rationale are in `parallel/aggregator-adjudications.json`.
- `vocab:02052`: W08/W09 identical KEEP judgment deduplicated once; retain `human resources` and `HR department`.
- `vocab:02481`: W10 index 2478 accepted as valid pending coverage; ID joined by source ID and aligned to source position 2477.
- Boundary repairs `vocab:00545`, `vocab:01837`, `vocab:02267` applied.
- Eight unresolved cross-audit conflicts and 94 upstream authority reviews remain explicitly isolated. They count as reviewed and are ineligible for production remediation.

## Validation and production boundary

- Strict validator: **PASS** (full population, decision schema, provenance, source alignment, learning eligibility, drift reconciliation, and exclusions).
- Deterministic batch generation: **PASS**; two regenerations produced byte-identical artifacts.
- Production diff: **0**. Vocabulary source, runtime, ASR, UI, native, spelling authority, tests, and APP_VERSION are unchanged on the audit branch.

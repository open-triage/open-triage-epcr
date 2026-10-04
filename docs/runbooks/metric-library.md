# Metric library

Validation now owns continuous numeric metrics and Boolean rules in one draft,
publication, catalog binding, and activation. The Metric library sits above Rule
library. Saving either editor saves both collections. Metrics never emit clinical
findings; a rule referencing a metric supplies severity, targets, and Review priority.

Create a metric, supply its English/Swedish wording, unit, expression, and optional
Boolean applicability. Enable **Review enabled** to make an enabled, published
metric available in Analytics. Review-enabled rules use the existing `review`
execution target. Publish and activate the shared configuration through the existing
Validation controls. Disabling a definition preserves its identity and history.
An enabled rule cannot depend on a disabled, invalid, or missing metric.

## Expressions

A metric's expression is bounded JSON, with these operators:

| Operator | Inputs | Output |
| --- | --- | --- |
| `value` | `elementId`, `unit` | One numeric scalar |
| `timestamp` | `elementId` | One offset-aware clinical timestamp, for an interval endpoint |
| `first`, `last` | `groupId`, `elementId`, `timeElementId`, `unit`, optional Boolean `where`, optional `minimumDistinctTimes` | Value in the first/last qualifying clinical group |
| `difference` | `left`, `right` expressions with matching numeric units | Left minus right; negative values are valid |
| `elapsed` | `start`, `end` timestamp expressions; `unit` of `s`, `min`, or `h` | Nonnegative elapsed duration |

`unit: "timestamp"` selects the timestamp of a qualifying repeated observation.
Input units explicitly map the recorded quantity; matching units are required for
numeric differences and comparisons. Recorded conflicting units are invalid. There
are no implicit numeric unit conversions. Coded categories and Boolean fields are
not numeric inputs.

For example, a PSAP-to-patient interval in seconds:

```json
{
  "operator": "elapsed",
  "start": { "operator": "timestamp", "elementId": "eTimes.01" },
  "end": { "operator": "timestamp", "elementId": "eTimes.07" },
  "unit": "s"
}
```

Select procedure codes and times inside the same `eProcedures.ProcedureGroup`.
Selection includes descendant groups, retaining parent instance identity. A
`where` predicate must use elements inside that group; document-wide eligibility
belongs in the metric's applicability field. Selection never borrows values from
another root occurrence. Missing clinical timestamps prevent ordering. Equal
clinical timestamps use lexicographic stable group-instance identity; input array
order is irrelevant. `minimumDistinctTimes` (integer 1–5000, default 1) requires that
many distinct instants among qualifying observations; equivalent timezone offsets
count as the same instant. Too few returns missing. A selected field with multiple
values is explicitly ambiguous.

Applicability and selection predicates use the existing Boolean language, without
`when` or `require`. Rule syntax adds:

```text
when metricAvailable("stable-metric-uuid")
require metricCompare("stable-metric-uuid", "less-or-equal", 90, "s")
```

Use `require metricAvailable("stable-metric-uuid")` when missing documentation itself
must fail. An unguarded numeric comparison with an unavailable metric is an
execution failure, and signing fails closed. The existing Boolean presence/absence
semantics remain unchanged. Metric-to-metric references are not supported.

## Analytics and evidence

The picker discovers configured definitions from the active shared Validation
version, independently of observed values, dates, or Review findings. Configured
entries identify their kind and version. The metric selector offers Records plus
enabled, Review-enabled metrics and rules. Recorded fields remain available for
grouping and filtering.

Selector rows open with a click, Enter, or Space; they have no separate Select
button. Both selectors and the analysis summary show **included** report
counts for the current date range and filters. A rule's included count is its
evaluable denominator (both pass and fail), and a metric includes reports with a
usable numeric value. Records includes the entire filtered population. Group and
filter choices count eligible reports containing that field or value, once per
report. Discovery still includes historical choices, so a choice can have zero
matching reports. Unavailable counts are shown explicitly and can be retried.

Continuous metrics support mean, median, minimum, maximum, and p90. P90 uses nearest
rank: sort valid per-report values and select the one-based position
`ceil(0.90 × sample size)`. Boolean rules require an explicit Pass or Fail selection
and offer counts or percentages. Their denominator is evaluable applicable reports;
an empty denominator is unavailable. Repeated-rule scopes contribute once per
report: any failure fails the report, all applicable passes pass, no applicable
scope is excluded, and any unresolved error makes the result unavailable.

Results and CSVs separate missing, recorded-absent, invalid, not-applicable, and
failed evaluations. Expand **Contributing reports and evidence** to inspect each
report's value, exclusion or failure reason, and permitted metric inputs.
Exports include the shared definition/version/catalog identity,
selected outcome or unit, percentile convention, report revision, amendment
sequence, and permitted contributing observations. Export revision checks reject
changed source data or configuration. Analytics produces no Review work and does
not alter the report's pinned signed configuration. Historical catalog IDs must
match explicitly; incompatible histories are reported as failed contributions.

Live/signing bundles include compiled metric dependencies. Findings include metric
identity, value/unit, failure reason when relevant, and contributing observations.
Acknowledgement fingerprints include those inputs and their shared version.
Review evidence respects identifying-data permissions.

Configured evaluation is bounded to 2,000 authorized signed reports and 50,000
input rows in each batch. Larger queries fail explicitly and must be narrowed.
Each metric is limited to 16,384 source characters, 64 expression nodes, depth 12,
and the clinical evaluator's traversal/value limits. A library holds at most 256
metrics. These limits also apply to browser evaluation.

## EMS definitions in NEMSIS full

The canonical `defines/validation/validation_nemsis-full.json` includes six enabled
continuous metrics and six Boolean rules. Installation or file import loads them
with the NEMSIS full definition. Four rules are enabled; trauma destination and
aspirin remain disabled with explicit `unresolved` notes. Source provenance and
original expressions remain in the JSON. These rules have severity/Review priority
None and the Review execution target.

All six metrics apply to all records. Missing observations yield no numeric value.
They use these catalog mappings:

| Metric | Mapping |
| --- | --- |
| PSAP to first defibrillation | `eTimes.01` to `eProcedures.01` for AED/manual SNOMED-CT codes `450661000124102`, `426220008` |
| PSAP to initial rhythm analysis | `eTimes.01` to `eVitals.01` for recorded `eVitals.03` rhythms except Artifact; includes AED findings |
| Pain change | Last minus first `eVitals.27`, numeric scale `eVitals.28 = 3328003`, scores 0–10, at least two distinct `eVitals.01` instants |
| PSAP to patient contact | `eTimes.01` to `eTimes.07` |
| Patient contact to scene departure | `eTimes.07` to `eTimes.09` |
| Scene departure to destination | `eTimes.09` to `eTimes.11` |

**Pain reduced** is one rule: when pain change is available, require a negative
change. Equal or higher final scores fail; missing pairs are not applicable.
**Pain intervention** is a separate rule: a numeric pain score of 7–10 requires an
occurrence of one of these `eMedications.03` RxNorm ingredients, with no timing or age
requirement: acetaminophen `161`, fentanyl `4337`, hydromorphone `3423`, ketamine `6130`,
ketorolac `35827`, or morphine `7052`. These choices intersect the catalog with
[NASEMSO's 2022 pain-management guideline](https://nasemso.org/wp-content/uploads/National-Model-EMS-Clinical-Guidelines_2022.pdf),
printed pages 93–94. The outcome measures documented analgesic occurrence; it does
not infer indication or assess dose, and does not include non-drug interventions.

The remaining mappings adapt the
[December 2009 EMS Performance Measures](https://www.ems.gov/assets/EMS_Performance_Measures_2009.pdf):

- **12-lead performed:** primary/secondary chest-pain impression `R07.9`, age at
  least 35 years (or 420 months), then SNOMED-CT `268400002` or left/right 12-lead
  ECG type. The age boundary follows the source denominator's exclusion of under-35s;
  missing age or other age units do not establish eligibility.
- **STEMI specialty destination:** the same age boundary, a STEMI rhythm and
  12-lead type in the same cardiac rhythm group, then destination capability
  `9908031` (PCI capable) or `9908033` (PCI capable 24/7).
- **Trauma-center destination (disabled):** injury criteria, cardiac-arrest
  exclusion, and hospital capability are mapped provisionally. The catalog uses
  2021 trauma criteria; correspondence to the source's 2006 criteria and accepted
  trauma-center levels still need definitions.
- **Aspirin administered (disabled):** chest pain, age, aspirin `1191`, and some
  ulcer/GI-bleed history codes are mapped. Aspirin-specific allergy, current
  anticoagulants, complete contraindication codes and missing-history handling
  remain unresolved.

## Persistence and verification

No database migration is needed. The existing `validation.version.source_rule`
JSONB column stores `{schemaVersion: 2, rules, metrics}` for metric-bearing versions;
legacy rule arrays and single-rule documents remain readable. Canonical packages
and compiled metric-bearing bundles explicitly use version 2. Both source and
compiled digests cover metrics. Legacy immutable publications are never rewritten.

Focused checks:

```sh
npm run build -w @open-triage/api
node apps/api/tests/metric-library.test.mjs
node --env-file=.env.local apps/api/tests/metric-library-postgres.integration.test.mjs
npm run test:a11y -w @open-triage/web -- e2e/metric-library.spec.ts
OPEN_TRIAGE_E2E_SERVER_MODE=true npm run test:a11y -w @open-triage/web -- e2e/metric-analytics.spec.ts
```

The PostgreSQL fixture rolls back its test user, publications, activation, and history.

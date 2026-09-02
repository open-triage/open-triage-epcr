# Quality and normalization policy

Review status: **proposed; clinical and product approval required before merge**.

This initial policy is deliberately small. It emits non-blocking, traceable
findings for unusual numeric vital signs and one additive unit conversion. It
never deletes, clips, winsorizes, rounds, or replaces the documented clinical
occurrence. Catalog datatype and schema validation remain separate signing
requirements.

## Version identifiers

| Contract | Proposed version |
| --- | --- |
| Quality findings | `clinical-quality-1.0.0-proposed` |
| Additive normalization | `clinical-normalization-1.0.0-proposed` |

Approval will remove the `-proposed` suffix in a separate commit without
changing the reviewed rules. Any later change to a rule, bound, unit,
conversion, or rounding behavior requires a new version.

## Quality rules

Each bound is inclusive. A finite numeric value below the minimum or above the
maximum produces the listed warning. Values exactly on either boundary do not.
Warnings do not block signing and do not change the source occurrence.

| Rule code | NEMSIS element | Clinical value | Unit | Inclusive review range |
| --- | --- | --- | --- | --- |
| `vital.sbp.unusual` | `eVitals.06` | Systolic blood pressure | UCUM `mm[Hg]` | 40–300 |
| `vital.dbp.unusual` | `eVitals.07` | Diastolic blood pressure | UCUM `mm[Hg]` | 20–200 |
| `vital.heart-rate.unusual` | `eVitals.10` | Heart rate | UCUM `/min` | 20–250 |
| `vital.spo2.unusual` | `eVitals.12` | Pulse oximetry | `%` | 50–100 |
| `vital.respiratory-rate.unusual` | `eVitals.14` | Respiratory rate | UCUM `/min` | 4–80 |
| `vital.glucose.unusual` | `eVitals.18` | Blood glucose | `mg/dL` | 20–600 |
| `vital.temperature.unusual` | `eVitals.24` | Temperature | UCUM `Cel` | 25–45 |
| `vital.etco2.unusual` | `eVitals.16`, `ETCO2Type=3340001` | ETCO2 | UCUM `mm[Hg]` | 10–100 |
| `vital.etco2.unusual` | `eVitals.16`, `ETCO2Type=3340003` | ETCO2 | `%` | 1.3–13.2 |
| `vital.etco2.unusual` | `eVitals.16`, `ETCO2Type=3340005` | ETCO2 | UCUM `kPa` | 1.3–13.3 |

An `eVitals.16` occurrence without a recognized `ETCO2Type` is retained but is
not evaluated or normalized; this avoids guessing a unit.

## Additive normalization rule

| Rule ID | Source | Derived value | Formula | Precision |
| --- | --- | --- | --- | --- |
| `etco2.kpa-to-mmhg` | `eVitals.16` with `ETCO2Type=3340005` (`kPa`) | UCUM `mm[Hg]` | source × 7.50062 | nearest 0.001 `mm[Hg]` |

The result records the source occurrence ID, element ID, source numeric value
and unit, derived numeric value and unit, rule ID, and normalization version.
The source `value_numeric`, lexical value, attributes, and provenance remain
unchanged.

## Exposed contracts

- Successful signing responses distinguish `qualityFindings` and
  `derivedValues`, and include both policy versions. The immutable signed
  snapshot stores the same arrays.
- `analytics.epcr` exposes report-level `quality_flags`, full
  `quality_findings`, `derived_values`, and both policy versions.
- `analytics.epcr_repeatable_element` retains the source value columns and adds
  per-occurrence finding details plus `source_unit_code`, `normalized_numeric`,
  `normalized_unit_code`, `normalization_rule_id`, and
  `normalization_rule_version`.
- Reprojection recomputes these additive outputs from the effective source
  occurrences, including signed amendments, under the projector's current
  explicitly reported rule versions.

The executable policy is
[`packages/contracts/quality-rules.mjs`](../packages/contracts/quality-rules.mjs).

## Approval record

Pending explicit clinical and product approval of every rule, unit, inclusive
bound, conversion factor, three-decimal rounding rule, and both version
identifiers above.

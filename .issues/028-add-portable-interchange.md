## What to build

Provide portable import and export for the canonical encounter document so patient data can move between OpenTriage and other systems without knowledge of internal UI structures. Support deterministic canonical JSON and standards-oriented NEMSIS XML while preserving repeats, attributes, coded values, null semantics, and custom elements.

## Acceptance criteria

- [ ] Canonical JSON export is deterministic, versioned, schema-valid, human-readable, and can be imported without data loss.
- [ ] NEMSIS XML export maps canonical groups, elements, attributes, repeats, codes, `NV`/`PN` values, and custom results to the pinned EMSDataSet schema.
- [ ] NEMSIS XML import creates an equivalent canonical document while preserving supported standard and custom content.
- [ ] Exported XML validates against the pinned NEMSIS 3.5.1 XSDs with diagnostics mapped back to canonical element paths.
- [ ] JSON and XML round trips preserve representative patient, incident, repeatable event, null, coded, unknown compatible, and custom-element values.
- [ ] Import/export remains available offline and makes no runtime request to NEMSIS or another service.
- [ ] Relevant schema-validation, mapping, deterministic-output, failure-diagnostic, and lossless-round-trip tests demonstrate the completed behavior.

## Blocked by

- Blocked by `027-migrate-review-summary-and-persistence.md`

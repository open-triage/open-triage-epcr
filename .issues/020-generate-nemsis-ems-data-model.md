## What to build

Generate and commit a comprehensive, deterministic, human-readable JSON catalog for the pinned NEMSIS 3.5.1 EMS/PCR dataset. The generated catalog is the authoritative universe of standard patient-care data elements available to internal records and form profiles, with no runtime dependency on nemsis.org.

The catalog must include enough datatype and value-source metadata to drive form controls directly. In addition to each element's original XSD datatype, resolve its usable base type and constraints where available. Import the official `Combined_ElementEnumerations.txt`, every publicly distributed Defined List and Suggested List linked from the NEMSIS Version 3 resources page, and the official NV and pertinent-negative definitions. Preserve external code-system identity where NEMSIS references a universe it does not distribute exhaustively.

## Acceptance criteria

- [ ] A documented generator consumes pinned official NEMSIS 3.5.1 XSD and data-dictionary sources and produces `nemsis-data-model-3.5.1.json` deterministically.
- [ ] The catalog contains every element in the official `EMSDataSet`, including identifiers, names, definitions, national/state designation, usage, source datatype, resolved usable datatype and constraints, and occurrence metadata.
- [ ] Every element has one normalized value-source representation: scalar, inline-enumerated, bundled-list-backed, or external-code-system-backed.
- [ ] Every official `EMSDataSet` enumeration code and human-readable description from `Combined_ElementEnumerations.txt` is embedded.
- [ ] Every element's permitted NV and pertinent-negative values are embedded with official codes and labels.
- [ ] All six public Defined Lists (Cause of Injury, Impression, Incident Location Type, Symptoms, Medications Given, and Procedures) and all four public Suggested Lists (Patient Activity, Environmental/Food Allergies, Medical/Surgical History, and Medication Allergy) are pinned, checksummed, bundled, and attached to their applicable elements.
- [ ] External code universes such as complete ICD-10, RxNorm, and SNOMED CT are represented explicitly, and partial Defined/Suggested Lists are not marked exhaustive.
- [ ] Catalog-level provenance records the NEMSIS release, source URLs, retrieval information, and SHA-256 checksums for every imported source.
- [ ] The committed JSON uses stable ordering and readable formatting suitable for human inspection and code review.
- [ ] Regeneration requires no manual transcription and a check command fails when the committed catalog differs from generated output.
- [ ] The production application reads only bundled artifacts and makes no runtime request to NEMSIS.
- [ ] A coverage test proves every field currently rendered by the app resolves datatype, permissible values, NV/PN choices, and recommended-list values exclusively from the generated JSON, without duplicate field-choice metadata for the lookup.
- [ ] Relevant completeness, provenance, value-source, determinism, and production-build tests demonstrate the generated catalog.

## Blocked by

None - can start immediately

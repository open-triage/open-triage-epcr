## What to build

Generate and commit a comprehensive, deterministic, human-readable JSON catalog for the pinned NEMSIS 3.5.1 EMS/PCR dataset. The generated catalog is the authoritative universe of standard patient-care data elements available to internal records and form profiles, with no runtime dependency on nemsis.org.

## Acceptance criteria

- [ ] A documented generator consumes pinned official NEMSIS 3.5.1 XSD and data-dictionary sources and produces `nemsis-data-model-3.5.1.json` deterministically.
- [ ] The catalog contains every element in the official `EMSDataSet`, including identifiers, names, definitions, national/state designation, usage, resolved datatype information, and occurrence metadata.
- [ ] Every element declares a complete value source: scalar constraints, all inline NEMSIS enumerated values, a bundled NEMSIS defined/suggested list, or an explicitly identified external code system.
- [ ] All element-specific permitted `NV` and pertinent-negative (`PN`) values are embedded with their codes and human-readable labels.
- [ ] Every publicly distributed NEMSIS defined and suggested list is pinned, checksummed, bundled, and linked to each applicable element; external licensed code universes are identified without claiming incomplete values are exhaustive.
- [ ] Every field currently shown by the application can resolve its datatype, permitted values, `NV`/`PN` choices, and recommended-list values exclusively from `nemsis-data-model-3.5.1.json`.
- [ ] Catalog-level provenance records the NEMSIS release, source URLs, retrieval information, and SHA-256 checksums for every imported source.
- [ ] The committed JSON uses stable ordering and readable formatting suitable for human inspection and code review.
- [ ] Regeneration requires no manual transcription and a check command fails when the committed catalog differs from generated output.
- [ ] The production application reads only bundled artifacts and makes no runtime request to NEMSIS.
- [ ] Relevant completeness, provenance, datatype, enumeration, `NV`/`PN`, recommended-list, current-form coverage, determinism, and production-build tests demonstrate the generated catalog.

## Blocked by

None - can start immediately

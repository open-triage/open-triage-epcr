## What to build

Generate and commit a comprehensive, deterministic, human-readable JSON catalog for the pinned NEMSIS 3.5.1 EMS/PCR dataset. The generated catalog is the authoritative universe of standard patient-care data elements available to internal records and form profiles, with no runtime dependency on nemsis.org.

## Acceptance criteria

- [ ] A documented generator consumes pinned official NEMSIS 3.5.1 XSD and data-dictionary sources and produces `nemsis-data-model-3.5.1.json` deterministically.
- [ ] The catalog contains every element in the official `EMSDataSet`, including identifiers, names, definitions, national/state designation, usage, source datatype, and occurrence metadata.
- [ ] Catalog-level provenance records the NEMSIS release, source URLs, retrieval information, and SHA-256 checksums for every imported source.
- [ ] The committed JSON uses stable ordering and readable formatting suitable for human inspection and code review.
- [ ] Regeneration requires no manual transcription and a check command fails when the committed catalog differs from generated output.
- [ ] The production application reads only bundled artifacts and makes no runtime request to NEMSIS.
- [ ] Relevant completeness, provenance, determinism, and production-build tests demonstrate the generated catalog.

## Blocked by

None - can start immediately

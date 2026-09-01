# Canonical NEMSIS data assets

`nemsis-data-model-3.5.1.json` is the complete, generated catalog of all 453
standard elements reachable in the official NEMSIS 3.5.1 `EMSDataSet`. Its
pinned XSD and machine-readable data-dictionary inputs, provenance, and
regeneration instructions are documented in `nemsis-3.5.1-sources/README.md`.
The application imports this bundled JSON through `nemsis-data-model.ts`; it
does not contact NEMSIS at runtime. The versioned
`nemsis-data-model.schema-1.0.0.json` file validates the generated catalog.

Element structure, datatypes, constraints, cardinality, NV/PN semantics, inline
enumerations, and official defined or suggested lists all live in this one
catalog. Medication and procedure search project their options directly from
the applicable elements and bundled lists. Provenance and SHA-256 checksums for
every pinned upstream source are recorded in the catalog itself; there are no
separate application-owned medication or procedure catalogs.

NEMSIS and SNOMED CT terminology artifacts remain subject to their respective
third-party terms, as noted by the repository licensing policy.

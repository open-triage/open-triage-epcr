# Pinned NEMSIS 3.5.1 sources

This directory contains the official source files used to generate
`../nemsis-data-model-3.5.1.json`. They were retrieved from the versioned NEMSIS
3.5.1 release and public-list directories on 2026-09-01 and are committed so
generation, testing, and production builds never depend on network access.

The source files retain their official CRLF bytes so their recorded checksums
remain independently verifiable. The local `.gitattributes` therefore disables
line-ending conversion and noisy line-oriented diffs for those pinned inputs.

- `Combined_ElementDetails_Full.txt` is the official machine-readable combined
  data-dictionary export. The generator selects its `EMSDataSet` element rows.
- `Combined_ElementEnumerations.txt` is the official enumeration export. Every
  enumeration associated with an `EMSDataSet` element is embedded with its code
  and human-readable description.
- `xsd/EMSDataSet_v3.xsd` and every XSD it directly includes were extracted
  from the official `NEMSIS_XSDs.zip` archive. The generator derives the
  reachable documented element universe from the EMS root schema and its `e*`
  section schemas, then requires exact identifier and core-metadata agreement
  with the data dictionary. Named simple types also resolve each source datatype
  to its usable primitive base; the data-dictionary facets provide per-element
  constraints, and common NV/PN types provide their official codes and labels.
- `lists/*.json` contains all six Defined Lists and all four Suggested Lists
  linked from the official Version 3 resources page at retrieval time. Their
  entries are stored once in the generated catalog and referenced by every
  applicable EMS element. These lists are explicitly marked non-exhaustive
  because their underlying ICD-10, RxNorm, and SNOMED CT universes are external.

Run `npm run generate:nemsis-data-model` at the repository root to regenerate
the catalog. Run `npm run check:nemsis-data-model` to fail if the committed
catalog differs from deterministic generated output. Source URLs and SHA-256
checksums for the dictionary, enumeration export, 28 XSD files, and ten JSON
lists are embedded in the generated catalog's `provenance.sources` array.

To update the release, replace these files from an official versioned NEMSIS
release, update the release and retrieval constants in the generator, regenerate,
and review the resulting source and catalog diff. Element records, values, and
constraints are generated directly from the pinned inputs without manual
transcription.

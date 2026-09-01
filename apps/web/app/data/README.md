# Local clinical terminology assets

`nemsis-data-model-3.5.1.json` is the complete, generated catalog of all 453
standard elements reachable in the official NEMSIS 3.5.1 `EMSDataSet`. Its
pinned XSD and machine-readable data-dictionary inputs, provenance, and
regeneration instructions are documented in `nemsis-3.5.1-sources/README.md`.
The application imports this bundled JSON through `nemsis-data-model.ts`; it
does not contact NEMSIS at runtime.

`nemsis-procedures.json` is a compact, offline projection of the official NEMSIS
3.5.1 `DefinedLists/Procedure/Procedure.json` file. It retains each SNOMED CT
code, NEMSIS suggested display label, source label, and category used by search.

The embedded manifest identifies the exact upstream Git revision, source date,
source URL, release, element, value system, and SHA-256 checksum of the upstream
JSON. The checksum is for the source file before projection. The bundled asset is
read directly by the application; no runtime call to NEMSIS is made.

The medication picker follows the same offline model. The pinned
`../medications.nemsis-3.5.1.json` catalog retains the recommended medication
codes, code-system discriminator, source labels, and concise display labels used
by search. `../medications.nemsis-3.5.1.manifest.json` records its NEMSIS release,
source URL, source date, and upstream SHA-256 checksum. Both medication and
procedure catalogs are searched locally and require no terminology service at
runtime.

NEMSIS and SNOMED CT terminology artifacts remain subject to their respective
third-party terms, as noted by the repository licensing policy.

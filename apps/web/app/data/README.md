# Local clinical terminology assets

`nemsis-procedures.json` is a compact, offline projection of the official NEMSIS
3.5.1 `DefinedLists/Procedure/Procedure.json` file. It retains each SNOMED CT
code, NEMSIS suggested display label, source label, and category used by search.

The embedded manifest identifies the exact upstream Git revision, source date,
source URL, release, element, value system, and SHA-256 checksum of the upstream
JSON. The checksum is for the source file before projection. The bundled asset is
read directly by the application; no runtime call to NEMSIS is made.

NEMSIS and SNOMED CT terminology artifacts remain subject to their respective
third-party terms, as noted by the repository licensing policy.

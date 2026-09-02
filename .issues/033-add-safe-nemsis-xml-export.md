# Add safe NEMSIS XML export

**Type:** AFK

## What to build

Export the canonical encounter document as deterministic NEMSIS 3.5.1 XML while preserving supported repeats, attributes, codes, null semantics, and custom results. Diagnostics must trace invalid output back to canonical paths.

## Acceptance criteria

- [ ] Export maps canonical groups, elements, attributes, repeats, codes, `NV`/`PN` values, and custom results to the pinned EMSDataSet schema.
- [ ] Exported XML validates against the pinned NEMSIS 3.5.1 XSDs.
- [ ] Validation diagnostics identify the originating canonical group occurrence and element path.
- [ ] Identical canonical input produces byte-for-byte identical XML.
- [ ] Export works offline and performs no runtime schema or terminology request.
- [ ] Relevant schema-validation, mapping, deterministic-output, custom-result, and diagnostic tests demonstrate the completed behavior.

## Blocked by

- Blocked by `032-add-canonical-json-interchange.md`

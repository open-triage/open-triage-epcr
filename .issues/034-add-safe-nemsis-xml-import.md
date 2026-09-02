# Add safe NEMSIS XML import

**Type:** AFK

## What to build

Import NEMSIS 3.5.1 XML into an equivalent canonical encounter without exposing the application to unsafe XML processing. Valid supported standard and custom content must survive a complete XML round trip.

## Acceptance criteria

- [ ] Import maps supported groups, elements, attributes, repeats, codes, `NV`/`PN` values, and custom results into canonical values.
- [ ] Parsing rejects DTDs, external entities, external schema resolution, and unsupported processing instructions without network or filesystem access.
- [ ] Parsing enforces documented file-size, nesting-depth, node-count, text-size, and expansion limits before application state is mutated.
- [ ] Invalid or incompatible XML leaves the active record unchanged and returns diagnostics mapped to XML and canonical paths where possible.
- [ ] JSON-to-XML-to-JSON round trips preserve representative patient, incident, repeating event, null, coded, unknown compatible, and custom values.
- [ ] Import works offline and performs no runtime schema or terminology request.
- [ ] Relevant schema-validation, hostile-input, resource-limit, failure-isolation, mapping, and lossless-round-trip tests demonstrate the completed behavior.

## Blocked by

- Blocked by `033-add-safe-nemsis-xml-export.md`

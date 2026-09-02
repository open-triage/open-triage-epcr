# Canonical data model and configuration guide

OpenTriage stores one canonical encounter document. UI components, persistence,
review, summaries, JSON interchange, and NEMSIS XML are projections of stable
NEMSIS or reverse-DNS custom identifiers; component names are never data keys.

## Updating and regenerating the standard catalog

The pinned inputs and provenance are described in
`apps/web/app/data/nemsis-3.5.1-sources/README.md`. For an update, download the
official versioned dictionary, enumeration export, XSD archive, and public lists;
retain their original bytes; update release, retrieval date, and URLs in the
generator; then run `npm run generate:nemsis-data-model` and
`npm run audit:nemsis-catalog`, followed by `npm run generate:database`. Commit
sources, generated JSON, the analytical mapping, and generated migration blocks
together. The
audit rejects element/enumeration omissions and additions and requires identical
pretty-printed output. Never hand-edit the generated catalog.

## Form and custom-element authoring

Copy `standard-encounter-form.json`, choose a stable profile `id` and incrementing
`version`, and select fields by catalog ID. Trace an ID from
`sections[].elements[]`, to `nemsis-data-model-3.5.1.json`, to the encounter's
`groups[].instances[].elements[]`, and finally to JSON or XML. Profiles control
labels, help, visibility, ordering, review grouping, and summary ordering;
datatypes, constraints, cardinality, coded values, NV, and PN are catalog-owned.

For custom elements, use `nemsis-custom-configuration.schema-1.0.0.json` and the
example configuration. Use stable reverse-DNS group/element IDs and declare all
metadata. Load configuration with `createElementCatalog`, reference its IDs in a
configured form, and validate capture with `validateCustomDataSet`. No component
change is required. Custom fixtures/profiles must never be imported by production
entry points.

## Compatibility and interchange guarantees

The encounter model, NEMSIS model, and form profile versions are checked
independently. Unsupported versions fail with canonical paths; callers can allow
known profile versions. Unknown namespaced extensions survive load, edit,
persistence, and export. Canonical JSON is deterministic and lossless. NEMSIS XML
uses catalog/XSD ordering and `eCustomResults`; embedded canonical metadata keeps
occurrence IDs and extensions lossless on OpenTriage round trips. External
receivers can validate against the pinned XSD. Production builds audit and bundle
the pinned standard catalog and neutral standard profile only.

Before merging, run `npm run typecheck`, `npm run lint`, `npm test`, and
`npm run build`, plus Playwright accessibility and deployment suites when browser
dependencies are available.

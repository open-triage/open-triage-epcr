# Canonical data model and configuration guide

OpenTriage stores one canonical encounter document. UI components, persistence,
review, summaries, and JSON interchange are projections of stable
NEMSIS or reverse-DNS custom identifiers; component names are never data keys.

## Updating the standard catalog

`defines/catalog/catalog_nemsis-3.5.1.json` is the canonical catalog. Edit it
directly; keep exact NEMSIS technical identifiers in `id` and human-readable
application wording in `name` and the other display fields. Publication exports agency definitions into the corresponding `local/` folders
under `defines/`. Checked-in base definitions remain authored inputs.

The pinned upstream inputs and provenance are described in
`apps/web/app/data/nemsis-3.5.1-sources/README.md`. After editing the canonical
catalog, run `npm run check:nemsis-data-model`, `npm run audit:nemsis-catalog`,
and `npm run check:database`. These commands validate the authored JSON against
its JSON Schema, pinned NEMSIS sources, and analytical projection without
modifying it. Schema migration and opening an editor do not import definitions. Admins select a JSON file in the editor’s import controls and click
**Import selected file**
to publish it as the next agency version. Imported version metadata is ignored,
and each import creates a new version, including repeated imports of the same file.
Forms and validation rules use the selected published catalog. Activation is separate. Explicit
synthetic-fixture setup seeds its own demonstration definitions.

## Form and custom-element authoring

Copy `standard-encounter-form.json`, choose a stable profile `id` and incrementing
`version`, and select fields by catalog ID. Trace an ID from
`sections[].elements[]`, to `nemsis-data-model-3.5.1.json`, to the encounter's
`groups[].instances[].elements[]`, and finally to canonical JSON. Profiles control
labels, help, visibility, ordering, review grouping, and summary ordering;
datatypes, constraints, cardinality, coded values, NV, and PN are catalog-owned.

For custom elements, use `nemsis-custom-configuration.schema-1.0.0.json` and the
example configuration. Use stable reverse-DNS group/element IDs and declare all
metadata. Load configuration with `createElementCatalog`, reference its IDs in a
configured form, and validate the configuration with
`validateCustomConfiguration`. No component change is required. Custom
fixtures/profiles must never be imported by production entry points.

The supported custom-data surface comprises configuration validation, combined
standard/custom catalog lookup, configured-form resolution, and the
`CustomDataSet` compatibility type. The application treats persisted
`CustomDataSet` values as opaque extension data: application save and recovery
pass their complete structure through losslessly, including unknown namespaced
results and vendor properties. There is intentionally no standalone custom-result
resolver, loader, setter, validator, serializer, or deserializer API. The
versioned encounter document and application persistence boundary own storage
and recovery.

## Compatibility and interchange guarantees

Product owner decision (2026-09-10): individual-record NEMSIS XML import and export is not a supported
library or product surface, and OpenTriage makes no compatibility promise for it. The former
test-only interchange module recovered embedded OpenTriage canonical JSON rather than parsing
general NEMSIS XML, so it was removed. The pinned NEMSIS catalog, generated data model, and official
XSD source machinery remain supported inputs to catalog generation and auditing; their presence
does not imply a record-level XML parser.

The encounter model, NEMSIS model, and form profile versions are checked independently. Unsupported
versions fail with canonical paths; callers can allow known profile versions. Unknown namespaced
extensions survive load, edit, and persistence. Canonical JSON is deterministic and lossless.
Production builds audit and bundle the pinned standard catalog and neutral standard profile only.

Before merging, run `npm run typecheck`, `npm run lint`, `npm test`, and
`npm run build`, plus Playwright accessibility and deployment suites when browser
dependencies are available.

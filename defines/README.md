# Installation definitions

This directory is the source of published configuration available on a new installation:

- `catalog/catalog_nemsis-3.5.1.json` is the complete, generated 453-element NEMSIS EMS catalog.
- `catalog/schema_nemsis-3.5.1.json` validates that catalog.
- `forms/form_nemsis-full.json` and `forms/form_sweden.json` are the complete canonical form definitions.
- `validation/validation_nemsis-full.json` and `validation/validation_sweden.json` are the complete authored rule lists.

The `default: true` NEMSIS form is published and activated during initial setup. Matching non-default `form_<key>.json` and `validation_<key>.json` files are discovered by filename and published as inactive options against the same NEMSIS catalog. Adding another matching set does not require changing the installer. Files must share a `key`; every form and validation file must use `catalogKey: "nemsis-3.5.1"`, and the validation file must name its `formKey`. Existing published database versions remain immutable; changing a JSON file does not silently rewrite an installed organization's versions.

The official NEMSIS Schematron XML and its generated importer remain in `packages/contracts` as upstream provenance and tooling; the install-time rule set is the JSON here. `apps/web/app/data/standard-encounter-form.json` is the separate focused phone UI profile, and `stationary-layout-1.0.0.json` is renderer layout, not an installable canonical form.

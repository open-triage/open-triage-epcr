# Installation definitions

This directory is the source of published configuration available on a new installation:

- `catalog/catalog_nemsis-3.5.1.json` is the canonical 453-element NEMSIS EMS catalog. Its stable technical identifiers live in `id`; its application wording lives in `name` and other display fields.
- `../packages/contracts/catalog.schema-1.0.0.json` is the authored JSON Schema contract that validates the canonical catalog.
- `forms/form_nemsis-full.json` and `forms/form_sweden.json` are the complete canonical form definitions.
- `validation/validation_nemsis-full.json` is the complete authored validation definition. It uses schema version 2 to include the mapped EMS metrics and rules.
- `localization/localization_sv.json` is the single Swedish localization definition. It contains catalog and validation wording. Catalog entries are keyed by stable element, group, list, code-system/code, and special-value identities, so future catalogs reuse translations whenever they retain those identities; entries for multiple releases may coexist. Each translation also carries the English source name, label, or description it was translated from, allowing audits to report source drift without changing identity matching.

NEMSIS full enables rules by default. Rules and metrics that still need source mappings
remain disabled and list the missing mappings in `unresolved`.

The `default: true` NEMSIS form is published and activated during initial setup. Matching non-default `form_<key>.json` and `validation_<key>.json` files are discovered by filename and published as inactive options against the same NEMSIS catalog. Standalone non-default forms, such as Sweden, remain available for import but are not seeded as installation pairs. Adding another matching set does not require changing the installer. Files must share a `key`; every form and validation file must use `catalogKey: "nemsis-3.5.1"`, and the validation file must name its `formKey`. Existing published database versions remain immutable; changing a JSON file does not silently rewrite an installed organization's versions.

The official NEMSIS Schematron XML and its generated importer remain in `packages/contracts` as upstream provenance and tooling; the install-time rule set is the JSON here. `apps/web/app/data/standard-encounter-form.json` is the separate focused phone UI profile, and `stationary-layout-1.0.0.json` is renderer layout, not an installable canonical form.

Tracked files under `defines/` are shared, authored installation inputs, not organization-owned exports. Repository scripts may read and validate them but must never rewrite them. Runtime publications are written only to the gitignored organization-scoped directories below. Change authored JSON files directly and review their diffs. A fresh application installation imports the catalog, localization, forms, and validation definitions into immutable published database versions. Existing published versions are preserved during upgrades.

## Publishing and transferring versions

All runtime packages require an explicit owning organization UUID:

| Package | Export directory |
| --- | --- |
| Catalog | `catalog/local/<organization-id>/` |
| Form | `forms/local/<organization-id>/` |
| Validation | `validation/local/<organization-id>/` |
| Hospital EPS/COS mapping | `hospital-mapping/local/<group-organization-id>/` |

Hospital connections and mappings belong to an agency group. Its directory key is
the parent organization's UUID returned by `app_identity.organization_group`,
not the selected child agency's UUID. The UUID is an internal database identity,
not an organization name, hostname, or external agency code.

Each editor discovers shared JSON templates directly in its parent type directory
and exports in its own organization subdirectory. It does not scan other
organizations or legacy JSON files directly under `local/`. `localization/`
contains shared installation translations and has no runtime export writer.

Copy a file to the receiving organization's scoped directory on another installation, or paste its
contents into **Canonical JSON files** in the editor, then import it. Catalog,
form and validation imports create immutable **published** versions; activation
remains a separate choice. Hospital mapping imports create a configuration draft
that must be tested before activation.

Packages use the versioned `opentriage-definition` format. Export filenames use
the name shown in the editor and source version, for example `nemsis-full-v1.json`.
Names are normalized to safe lowercase filename components. Atomic, exclusive
writes prevent overwriting an older publication or a different package with the
same filename. SHA-256 remains the internal package identity. The embedded
content digest detects corruption, not authenticity. Import only trusted configuration.
Unknown format versions and changed content digests are rejected.

Catalog dependencies use a fingerprint of the complete editable published catalog
snapshot, including stable element identities, constraints, code lists, custom
fields, and localization. Installation-specific release UUIDs are excluded. A name
or a newer version number alone does not establish compatibility. Install a catalog's
base first, then its derived catalog, then forms and validations. Bundled installation
files remain supported and require their exact installed base catalog.

Catalog, form and validation imports validate and publish in one database transaction, do not overwrite drafts,
and do not activate configuration. Existing local version numbers remain unchanged;
imported versions receive local numbers and record the source version and package
digest in their publication change note. Reimporting the same package reuses the
published version. Validation rules are recompiled locally rather than trusting a
foreign compiled bundle.

Set `OPENTRIAGE_DEFINITIONS_ROOT` to use another definitions directory; the same
`<type>/local/<organization-id>/` layout applies. Deployments must provide persistent writable storage
there. Database publication commits before file export: if storage fails, the API
explicitly reports that publication succeeded and provides its ID. Use **Export
selected published version** to retry without publishing again.

Legacy exports directly under `<type>/local/` must be assigned to a verified
owner before moving them into an organization subdirectory. Match their canonical
content to the organization's published database version; do not infer ownership
from a filename or copy private configurations to every organization. A shared
baseline catalog may be copied into each organization that already uses that
exact catalog. Preserve the JSON bytes and embedded hashes, and never overwrite
a different file with the same name. Moving files does not import or activate them.

Tests that publish or export packages must override `OPENTRIAGE_DEFINITIONS_ROOT`
with a temporary directory and remove it after the test suite, including failures.
The API integration suite uses `tests/fixtures/temporary-definitions.mjs` for this.

The catalog JSON Schema lives in `packages/contracts/catalog.schema-1.0.0.json`,
outside this definitions directory. Its relocation preserves the historical catalog
artifact checksum and does not create a new catalog release.

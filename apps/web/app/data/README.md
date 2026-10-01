# NEMSIS source assets and UI profiles

`../../../../defines/catalog/catalog_nemsis-3.5.1.json` is the complete, canonical catalog of all 453
standard elements reachable in the official NEMSIS 3.5.1 `EMSDataSet`. Its
pinned XSD and machine-readable data-dictionary inputs, provenance, and
source-audit instructions are documented in `nemsis-3.5.1-sources/README.md`.
The application imports this bundled JSON through `nemsis-data-model.ts`; it
does not contact NEMSIS at runtime. The versioned
`../../../../packages/contracts/catalog.schema-1.0.0.json` file is the authored JSON Schema contract that validates the canonical catalog.

Element structure, datatypes, constraints, cardinality, NV/PN semantics, inline
enumerations, and official defined or suggested lists all live in this one
catalog. Medication and procedure search project their options directly from
the applicable elements and bundled lists. Provenance and SHA-256 checksums for
every pinned upstream source are recorded in the catalog itself; there are no
separate application-owned medication or procedure catalogs.

NEMSIS and SNOMED CT terminology artifacts remain subject to their respective
third-party terms, as noted by the repository licensing policy.

## Canonical encounter document

The shared `@open-triage/contracts` package owns
`encounter-document.schema-1.0.0.json` and its matching TypeScript contract.
`synthetic-encounter-document.json` and the public `demo-*.json` resources are
generated from the committed initial dispatch sample by
`scripts/generate-demo-fixtures.ts`. The generator runs the production dispatch
validator and projector; `npm run check:demo-fixtures` rejects stale or manually
duplicated artifacts.

Documents identify their own model version, NEMSIS data-model version, form
profile version, and encounter metadata. Patient data is grouped only by stable
NEMSIS identities such as `eVitals.VitalGroup` or reverse-DNS custom identities
such as `org.example.ems:stroke-assessment`. UI field and component names are
never part of the persisted model.

Every repeating group has an `instanceId`, and every element occurrence has an
`occurrenceId`. Values use explicit `absent`, `null`,
`pertinent-negative`, `coded`, or `scalar` variants; sentinel strings are
not interpreted. NEMSIS NV codes live in a null value's `notValue` object.
Attributes are retained on group and value occurrences. Unknown compatible
properties and namespaced custom groups/elements are preserved losslessly by
the loader and serializer.

## Standard encounter form

`standard-encounter-form.json` is the human-readable, complaint-neutral phone
form profile. It selects fields by stable catalog identifiers and controls
section visibility, quick actions, ordering, review groups, and summary order.
Element labels and descriptions always come from the pinned catalog. The profile compiler rejects unsupported presentation
structures and semantic overrides; datatypes, cardinality, coded values, and
NV/PN behavior always come from the catalog above.

## Canonical stationary layout

`stationary-layout-1.0.0.json` places every catalog element and structural
group exactly once for the full-record renderer. Its versioned JSON Schema and
the compiler in `stationary-layout.ts` limit it to presentation metadata while
checking stable identities, catalog ancestry, custom namespaces, read-only
agency/configuration metadata, and complete coverage. Standard labels and help text
resolve from the canonical catalog and are not copied into this layout. Run
`npm run generate:stationary-layout` after an intentional catalog update;
`npm run check:stationary-layout` rejects stale committed output.

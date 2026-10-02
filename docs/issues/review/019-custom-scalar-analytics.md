<!-- review:slice-019 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-54, US-55, US-56, US-57, US-67.

## What to build

Deliver a complete author-document-sign-project-analyze path for standalone custom fields using long-table occurrence rows. Introduce the one-time standalone row representation and migrate/rebuild existing custom scalar analytics without new columns per custom definition.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] An existing catalog/form author can introduce another custom field, document and sign it, and find its supported operations in BI after projection without a field-specific schema change.
- [ ] Standalone custom values have one typed long-table occurrence row with stable identities, pinned definition context, privacy classification, exceptional values, and effective amendment lineage.
- [ ] The table/projector support genuine report-level occurrences without inventing clinical groups or changing clinical recurrence; existing grouped/repeated values remain valid.
- [ ] The analytical dictionary includes compatible and historical custom definitions, while opaque/binary or otherwise unsupported chart operations are explicit rather than coerced.
- [ ] A documented compatibility transition and bounded rebuild cover prior JSON additions and effective add/replace/remove amendments; the BI path never counts both legacy and new copies.
- [ ] Actual database-role, migration/replay, API, and browser tests cover identified/non-identifying scalar/coded/numeric/date/boolean examples, exceptional values, retired definitions, and adding a new field with unchanged table columns.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/659

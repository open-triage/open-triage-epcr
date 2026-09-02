# Drive the standard form from JSON

**Type:** AFK

## What to build

Introduce a human-readable `standard-encounter-form.json` that selects and arranges catalog elements for the clinically neutral interface. It may control presentation but must not redefine NEMSIS meaning or depend on a complaint category.

## Acceptance criteria

- [ ] The profile selects fields exclusively by stable standard or namespaced custom element identifiers.
- [ ] Configuration controls sections, quick actions, field order, supported visibility, label overrides, help text, review grouping, and summary ordering.
- [ ] Standard datatype, cardinality, coded-value, and `NV`/`PN` semantics come from the catalog and cannot be weakened by the profile.
- [ ] Validation rejects unknown elements, illegal overrides, duplicate placements, unsupported group structures, and invalid custom references with actionable paths.
- [ ] The neutral phone form renders from JSON without importing a TypeScript encounter-definition object.
- [ ] A test-only profile can add, hide, relabel, and reorder supported elements without React or domain-logic changes.
- [ ] Relevant profile-validation, configured-rendering, accessibility, and minimum-viewport tests demonstrate the completed behavior.

## Blocked by

- Blocked by `027-migrate-vital-events.md`
- Blocked by `028-migrate-medication-events.md`
- Blocked by `029-migrate-procedure-events.md`

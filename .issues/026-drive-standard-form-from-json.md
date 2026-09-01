## What to build

Introduce a human-readable `standard-encounter-form.json` that defines the clinically neutral documentation interface by selecting and arranging elements from the comprehensive catalog. The profile controls supported presentation choices without redefining NEMSIS meaning or coupling the form to a complaint category.

## Acceptance criteria

- [ ] The form profile selects fields exclusively by stable standard or namespaced custom element identifiers.
- [ ] Configuration controls sections, event quick actions, field order, supported visibility, user-facing label overrides, help text, review grouping, and summary ordering.
- [ ] Standard datatype, cardinality, coded-value, and `NV`/`PN` semantics come from the catalog and cannot be silently weakened by the form profile.
- [ ] Profile validation rejects unknown elements, illegal overrides, duplicate placements, unsupported group structures, and invalid custom-element references with actionable paths.
- [ ] The current neutral phone form renders from the JSON profile without importing a TypeScript encounter-definition object.
- [ ] A test-only profile can add, hide, relabel, and reorder supported elements without React or domain-logic changes.
- [ ] Relevant profile-validation, configured-rendering, accessibility, and minimum-viewport tests demonstrate the completed behavior.

## Blocked by

- Blocked by `025-migrate-clinical-event-data.md`

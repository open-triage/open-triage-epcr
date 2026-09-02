# Migrate medication events to canonical groups

**Type:** AFK

## What to build

Move medication administration capture onto repeating canonical encounter groups using the shared event adapter. Terminology selection, dosage, route, response, warning, editing, and display behavior must operate on standards-based values.

## Acceptance criteria

- [ ] Medication administrations use their catalog element identities within correctly repeating canonical groups.
- [ ] Coded medication, dose, unit, route, response, null, and warning states use the canonical value representation.
- [ ] Creating and editing an administration updates one group occurrence without a parallel legacy event.
- [ ] Bundled terminology binds through catalog elements without event rules embedded in React components.
- [ ] Timeline, review, summary, persistence, reset, and supported legacy-state migration operate on canonical values.
- [ ] Relevant capture, terminology, editing, migration, validation, persistence, review, summary, and phone-flow tests demonstrate the completed behavior.

## Blocked by

- Blocked by `026-migrate-note-events.md`

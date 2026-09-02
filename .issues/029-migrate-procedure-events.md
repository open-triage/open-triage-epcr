# Migrate procedure events to canonical groups

**Type:** AFK

## What to build

Move procedure capture onto repeating canonical encounter groups using the shared event adapter. Terminology selection, attempts, success, outcome, complications, warning, editing, and display behavior must operate on standards-based values.

## Acceptance criteria

- [ ] Procedures use their catalog element identities within correctly repeating canonical groups.
- [ ] Coded procedure, attempts, success, outcome, complications, null, and warning states use the canonical value representation.
- [ ] Creating and editing a procedure updates one group occurrence without a parallel legacy event.
- [ ] Bundled terminology binds through catalog elements without event rules embedded in React components.
- [ ] Timeline, review, summary, persistence, reset, and supported legacy-state migration operate on canonical values.
- [ ] Relevant capture, terminology, editing, migration, validation, persistence, review, summary, and phone-flow tests demonstrate the completed behavior.

## Blocked by

- Blocked by `026-migrate-note-events.md`

# Migrate incident data to the canonical document

**Type:** AFK

## What to build

Move response, dispatch, crew, scene, and timing information onto the canonical encounter document. The phone header and incident timeline must render from and update the same standards-based record used by the patient editor.

## Acceptance criteria

- [ ] Response, dispatch, crew, scene, and timing values use their corresponding catalog element and group identities.
- [ ] The phone header and incident timeline render from the canonical document without category-specific behavior.
- [ ] Editing, refresh recovery, and reset operate without parallel legacy incident state.
- [ ] Existing supported browser state is upgraded deterministically; incompatible state is preserved for recovery and reported clearly rather than silently reset or reinterpreted.
- [ ] Relevant display, editing, validation, migration, persistence, reset, and phone-flow tests demonstrate the completed behavior.

## Blocked by

- Blocked by `024-migrate-patient-data.md`

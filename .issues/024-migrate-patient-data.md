# Migrate patient data to the canonical document

**Type:** AFK

## What to build

Move the neutral synthetic encounter's patient identity, demographics, and history selections onto the canonical encounter document. The existing patient editor and phone header must read and update those standards-based values without retaining a parallel legacy patient model.

## Acceptance criteria

- [ ] Patient identity, demographics, and history selections are stored under their corresponding catalog element and group identities.
- [ ] The patient editor resolves labels, datatypes, choices, null behavior, and references through the catalog rather than bespoke field metadata.
- [ ] Editing, refresh recovery, and reset update one canonical document without parallel legacy patient state.
- [ ] Existing supported browser state is upgraded deterministically; incompatible state is preserved for recovery and reported clearly rather than silently reset or reinterpreted.
- [ ] The neutral synthetic fixture remains readable JSON and contains values rather than form definitions.
- [ ] Relevant capture, validation, migration, persistence, reset, and phone-flow tests demonstrate the completed behavior.

## Blocked by

- Blocked by `019-establish-neutral-standard-encounter.md`
- Blocked by `023-define-canonical-encounter-document.md`

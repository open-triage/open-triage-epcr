# Migrate vital events to canonical groups

**Type:** AFK

## What to build

Move vital-set capture onto repeating canonical encounter groups using the event adapter established by note migration. Scalar, unavailable, pertinent-negative, warning, editing, and display behavior must all operate on canonical values.

## Acceptance criteria

- [ ] Vital sets use their catalog element identities within correctly repeating canonical groups.
- [ ] Scalar, `NV`, `PN`, and acknowledged-warning states use the canonical value representation.
- [ ] Creating and editing a vital set updates one group occurrence without a parallel legacy event.
- [ ] Timeline, review navigation, summary, refresh recovery, reset, and supported legacy-state migration operate on canonical values.
- [ ] Relevant capture, editing, migration, validation, persistence, review, summary, and phone-flow tests demonstrate the completed behavior.

## Blocked by

- Blocked by `026-migrate-note-events.md`

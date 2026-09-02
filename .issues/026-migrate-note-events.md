# Migrate note events to canonical groups

**Type:** AFK

## What to build

Move note capture onto repeating canonical encounter groups, establishing the shared event adapter used by later event migrations. Creating, editing, reviewing, summarizing, and restoring a note must operate on one standards-based group occurrence.

## Acceptance criteria

- [ ] Notes use stable catalog element identities within the correct repeating canonical group.
- [ ] Creating and editing a note updates the same group occurrence without a parallel legacy event.
- [ ] Timeline, review navigation, summary, refresh recovery, and reset operate from the canonical value.
- [ ] Existing supported note state is upgraded deterministically and incompatible data remains recoverable with an actionable diagnostic.
- [ ] Relevant capture, editing, migration, validation, persistence, review, summary, and phone-flow tests demonstrate the completed behavior.

## Blocked by

- Blocked by `025-migrate-incident-data.md`

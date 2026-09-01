## What to build

Drive note capture end to end from an event definition, establishing the reusable event-configuration seam through the simplest event type. The configured behavior must cover quick action, editor, validation, timeline, review navigation, and completed summary.

## Acceptance criteria

- [ ] The note event definition controls its labels, quick-action presence, requiredness, NEMSIS references, and validation messages.
- [ ] Adding and editing a note continues to update one canonical timeline entry.
- [ ] Review findings and the completed summary resolve note labels and metadata from the definition.
- [ ] React components do not contain chest-pain-specific note configuration.
- [ ] Relevant tests demonstrate configured capture, validation, editing, review navigation, persistence, and summary output.

## Blocked by

- Blocked by `012-versioned-encounter-definition.md`

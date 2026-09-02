# Configured vital group

**Status:** Completed — merged in PR #35.

## What to build

Drive vital-sign capture end to end from the versioned encounter definition, including displayed fields, units, permitted absence states, validation, plausibility warnings, timeline formatting, review navigation, and summary presentation.

## Acceptance criteria

- [ ] The vital-group definition controls field labels, order, units, requiredness, NEMSIS references, permitted null or pertinent-negative states, and validation boundaries.
- [ ] The vital editor renders its configured fields without duplicating clinical rules in the component.
- [ ] Timeline status, validation findings, direct correction, warning acknowledgement, and summary output use the configured metadata.
- [ ] Existing saved vital entries remain readable after the refactor.
- [ ] Relevant tests demonstrate valid, invalid, unavailable, unusual-but-acknowledgeable, edited, persisted, and summarized vital sets.

## Blocked by

- Blocked by `013-configured-note-event.md`

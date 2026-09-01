## What to build

Drive medication capture end to end from the versioned encounter definition while preserving the bundled NEMSIS terminology catalog and current quick-capture behavior.

## Acceptance criteria

- [ ] The medication event definition controls field labels and order, terminology binding, dose units, routes, requiredness, NEMSIS references, and warning behavior.
- [ ] Medication search still resolves the pinned local catalog and preserves code, code type, and display label.
- [ ] Timeline formatting, review findings, warning acknowledgement, correction, and summary output use configured metadata.
- [ ] Existing saved medication entries remain readable after the refactor.
- [ ] Relevant tests demonstrate configured search, incomplete capture, validation, warning acknowledgement, editing, persistence, and summary output.

## Blocked by

- Blocked by `013-configured-note-event.md`

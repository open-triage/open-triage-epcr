# Configured procedure event

**Status:** Completed — merged in PR #37.

## What to build

Drive procedure capture end to end from the versioned encounter definition while preserving the bundled NEMSIS terminology catalog and current quick-capture behavior.

## Acceptance criteria

- [ ] The procedure event definition controls field labels and order, terminology binding, attempts, success, outcome, complications, requiredness, NEMSIS references, and warning behavior.
- [ ] Procedure search still resolves the pinned local catalog and preserves code and display label.
- [ ] Timeline formatting, review findings, warning acknowledgement, correction, and summary output use configured metadata.
- [ ] Existing saved procedure entries remain readable after the refactor.
- [ ] Relevant tests demonstrate configured search, incomplete capture, validation, warning acknowledgement, editing, persistence, and summary output.

## Blocked by

- Blocked by `013-configured-note-event.md`

# Configured interface composition

**Status:** Completed — merged in PR #38.

## What to build

Compose the phone interface from the versioned definition so event availability, quick-action order, labels, validation grouping, and completed-summary ordering can change without modifying React components.

## Acceptance criteria

- [ ] Configuration controls which supported quick actions are shown and their order and accessible labels.
- [ ] Configuration controls review grouping and completed-summary ordering for supported event types.
- [ ] The current chest-pain definition reproduces the accepted MVP interface and phone journey.
- [ ] Touch targets, keyboard behavior, accessible names, focus behavior, and non-color validation cues remain intact.
- [ ] Relevant tests demonstrate configured composition and the complete minimum-viewport journey.

## Blocked by

- Blocked by `014-configured-vital-group.md`
- Blocked by `015-configured-medication-event.md`
- Blocked by `016-configured-procedure-event.md`

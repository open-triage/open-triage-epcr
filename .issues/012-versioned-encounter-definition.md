# Versioned encounter definition

**Status:** Completed — merged in PR #33.

## What to build

Render the existing synthetic encounter's scenario, patient, and dispatch context from a validated, versioned definition obtained through a definition-provider interface. The initial provider remains a bundled static implementation so the prototype retains static deployment while UI code no longer depends on where definitions are stored.

## Acceptance criteria

- [ ] A versioned encounter definition contains the existing scenario identity, dates, patient context, dispatch context, display labels, and applicable NEMSIS references.
- [ ] The application obtains the definition through a stable provider interface whose bundled implementation requires no API or database.
- [ ] The existing encounter header and patient editor render from the definition without an intentional visible or behavioral change.
- [ ] Invalid definitions fail with a clear diagnostic rather than producing a partially configured interface.
- [ ] Relevant tests demonstrate definition validation, provider behavior, and the unchanged synthetic journey.

## Blocked by

None - can start immediately

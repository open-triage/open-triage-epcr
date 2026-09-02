# Prove definition substitutability

**Status:** Completed — merged in PR #39.

## What to build

Prove the configuration seam with a test-only alternate encounter definition. Demonstrate that supported interface changes can be made through configuration alone while rejecting invalid definitions and preserving compatible saved state.

## Acceptance criteria

- [ ] A test-only alternate definition relabels and reorders fields, changes supported requiredness, and hides an event without changing React components.
- [ ] Tests demonstrate that the alternate definition changes capture, validation, review, and summary behavior consistently.
- [ ] Structurally invalid definitions and unsupported configuration constructs are rejected with actionable diagnostics.
- [ ] Definition identity and version are retained with persisted encounter state, with explicit behavior for incompatible state.
- [ ] The production build continues to ship only the accepted synthetic chest-pain definition.

## Blocked by

- Blocked by `017-configured-interface-composition.md`

## What to build

Move notes, vital sets, medication administrations, and procedures onto repeating NEMSIS groups in the canonical encounter document. Capture, editing, timeline presentation, validation, and persistence must operate directly on standards-based values while preserving the accepted event-first phone journey.

## Acceptance criteria

- [ ] Notes, vital sets, medications, and procedures are represented by their NEMSIS element identities within correctly repeating canonical groups.
- [ ] Editor drafts and saved entries use one canonical value representation for scalar, coded, `NV`, `PN`, and custom values.
- [ ] Creating and editing an event updates the same canonical group occurrence without maintaining a parallel legacy event model.
- [ ] Timeline labels and summaries resolve catalog and form-profile metadata while retaining clinical readability.
- [ ] Existing bundled terminology catalogs bind to the appropriate NEMSIS elements without embedding event-specific rules in React components.
- [ ] Refresh recovery and reset preserve the accepted phone behavior using only the canonical encounter document.
- [ ] Relevant repeatable-entry, editing, validation, persistence, terminology, and phone-flow tests demonstrate the completed behavior.

## Blocked by

- Blocked by `024-migrate-patient-and-incident-data.md`

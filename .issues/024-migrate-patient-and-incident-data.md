## What to build

Move the neutral synthetic encounter's patient, response, dispatch, crew, scene, and timing information onto the canonical encounter document. The existing phone header and incident timeline must read and update the same standards-based document that future interfaces and transfers will use.

## Acceptance criteria

- [ ] Patient identity, demographics, history selections, response, dispatch, crew, scene, and timing values are stored under their corresponding catalog element and group identities.
- [ ] The patient editor resolves labels, datatypes, choices, null behavior, and references through the catalog and form profile rather than bespoke field metadata.
- [ ] The phone header and incident timeline render from the canonical document without category-specific behavior.
- [ ] Editing, refresh recovery, reset, and validation update one canonical document without parallel legacy patient or incident state.
- [ ] The neutral synthetic fixture remains readable JSON and contains only synthetic encounter values, not form definitions.
- [ ] Relevant capture, validation, persistence, reset, and phone-flow tests demonstrate the completed behavior.

## Blocked by

- Blocked by `019-establish-neutral-standard-encounter.md`
- Blocked by `023-define-canonical-encounter-document.md`

# Support custom data elements

**Status:** Completed — merged in PR #56.

## What to build

Make custom data elements first-class extensions of the same data model used for standard NEMSIS elements. A deployment can define, validate, persist, display, and transfer namespaced custom elements and custom result values without changing application code or weakening the integrity of standard element definitions.

## Acceptance criteria

- [ ] A documented JSON contract represents NEMSIS custom configuration metadata including title, definition, datatype, recurrence, usage, potential values, permitted `NV`/`PN` values, and grouping/correlation identity.
- [ ] Custom element identifiers are namespaced and cannot collide with or overwrite standard NEMSIS element identifiers.
- [ ] Custom definitions are validated against supported datatypes, constraints, coded values, and group semantics with actionable diagnostics.
- [ ] Standard and custom elements can be queried through one catalog interface while retaining clear provenance and ownership.
- [ ] Adding a valid custom element and selecting it in a test form requires configuration changes only, not application-code changes.
- [ ] Unknown compatible custom elements survive load, edit, persistence, and serialization without data loss.
- [ ] Relevant extension, collision, validation, persistence, and configuration-only tests demonstrate the completed behavior.

## Blocked by

- Blocked by `021-preserve-nemsis-structure-and-semantics.md`

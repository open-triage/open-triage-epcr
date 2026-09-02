# Add canonical JSON interchange

**Type:** AFK

## What to build

Provide offline import and export of the canonical JSON encounter document. A record exported from OpenTriage must be deterministic, inspectable, schema-valid, and import without losing supported, unknown compatible, or custom content.

## Acceptance criteria

- [ ] Export is deterministic, versioned, schema-valid, and human-readable.
- [ ] Import validates structure and compatibility before mutating application state.
- [ ] Invalid or incompatible imports leave the active record unchanged and provide actionable paths and recovery guidance.
- [ ] Round trips preserve patient, incident, repeating event, null, coded, unknown compatible, and custom values.
- [ ] Import applies documented file-size and structural-complexity limits and fails safely when exceeded.
- [ ] Import/export is available offline and makes no runtime network request.
- [ ] Relevant deterministic-output, validation, failure-isolation, resource-limit, and lossless-round-trip tests demonstrate the completed behavior.

## Blocked by

- Blocked by `031-migrate-review-summary-and-persistence.md`

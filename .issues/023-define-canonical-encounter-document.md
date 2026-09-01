## What to build

Define the canonical, versioned JSON encounter document used for all internal patient-data handling. Encounter values are stored using stable NEMSIS group and element identities, preserve repeats and attributes, support custom elements, and remain understandable without knowledge of React components or application-specific state shapes.

## Acceptance criteria

- [ ] A shared JSON Schema and TypeScript contract define document identity, model version, form-profile version, encounter metadata, NEMSIS groups/elements, attributes, repeats, and custom values.
- [ ] Values are addressed by stable NEMSIS or namespaced custom identifiers rather than bespoke UI field names.
- [ ] The document distinguishes absent, null-valued, pertinent-negative, coded, scalar, and repeating values without ambiguous sentinel strings.
- [ ] Loading validates structure and data-model compatibility with actionable element and group paths.
- [ ] Compatible unknown and custom content is preserved losslessly rather than discarded by typed application code.
- [ ] A small, pretty-printed synthetic encounter document is understandable to a human and passes schema validation.
- [ ] Relevant schema, round-trip, repeatability, custom-element, and invalid-document tests demonstrate the completed behavior.

## Blocked by

- Blocked by `022-support-custom-data-elements.md`

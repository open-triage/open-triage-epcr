## What to build

Enrich the generated NEMSIS data-model catalog with the structural and validation semantics required to represent patient records faithfully. Preserve where elements occur, how groups repeat, which datatypes and attributes apply, and which values are structurally valid so later form and interchange code does not duplicate or guess standard rules.

## Acceptance criteria

- [ ] Each element records its EMS dataset group path and the occurrence/cardinality semantics of both the element and its containing groups.
- [ ] The catalog resolves XSD common types into explicit string, numeric, date/time, pattern, length, precision, and boundary constraints without losing the original type name.
- [ ] Nillability and permitted NEMSIS `NV` and `PN` attributes are represented at the element level.
- [ ] Repeating and correlated groups retain stable structural identities suitable for canonical encounter instances.
- [ ] `nemsis-data-model-3.5.1.json` is the exclusive source of truth for NEMSIS element identity, datatype, constraints, cardinality, code/value sources, `NV`/`PN` semantics, and recommended-list metadata; application and form code only reference catalog element IDs.
- [ ] Automated guardrails fail when production TypeScript, React components, or form profiles duplicate or hardcode data-element metadata outside the catalog; presentation-only configuration remains allowed.
- [ ] A versioned JSON Schema validates the generated catalog itself and rejects malformed or unsupported generated structures with actionable paths.
- [ ] Tests compare representative elements from every EMS section with the pinned XSD sources and detect structural drift.
- [ ] Relevant generation, schema-validation, and source-fidelity tests demonstrate the completed behavior.

## Blocked by

- Blocked by `020-generate-nemsis-ems-data-model.md`

## What to build

Deliver the compact Checklist peer view for the curated non-event documentation. A clinician can complete the scenario's assessment, disposition, and narrative fields, see what remains required, and correct NEMSIS-derived validation findings without navigating a comprehensive tablet-style section hierarchy.

## Acceptance criteria

- [ ] The Checklist view presents only the curated MVP assessment, disposition, narrative, and other selected non-event inputs.
- [ ] The interface shows a clear remaining-required count that does not rely on color alone.
- [ ] Each included input applies its curated NEMSIS datatype, cardinality, usage, and permitted `NV`/`PN` requirements.
- [ ] Validation findings show the relevant NEMSIS reference and navigate or focus the affected input.
- [ ] Assessment, disposition, and narrative values persist across view changes and refresh.
- [ ] The checklist remains usable at 390 × 844 and the 360 × 800 minimum viewport without a desktop side rail.
- [ ] Relevant validation, persistence, and phone-flow tests demonstrate the completed behavior.

## Blocked by

- Blocked by `002-capture-note-in-timeline.md`

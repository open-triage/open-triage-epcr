## What to build

Let a clinician add, review, and edit repeatable timestamped vital-sign sets from the phone timeline. The included vital fields apply their curated NEMSIS 3.5.1 datatype, cardinality, usage, and permitted `NV`/`PN` requirements, with blocking errors and clearly distinguished plausibility warnings.

## Acceptance criteria

- [ ] The Vitals quick action opens a phone-appropriate editor and creates a repeatable timestamped vital set.
- [ ] Multiple vital sets can be captured and appear as distinct chronological timeline entries.
- [ ] Each saved entry shows a concise clinically legible summary and its NEMSIS group reference.
- [ ] Tapping a vital entry edits the same canonical entry and permits correction of its clinical time.
- [ ] Invalid or missing values produce NEMSIS-referenced errors that block a valid entry state.
- [ ] Clinically unusual but permitted configured values produce warnings that are visually distinct from errors.
- [ ] Allowed and prohibited `NV`/`PN` cases for the included vital elements behave according to the curated source requirements.
- [ ] Relevant validation, repeatable-entry, persistence, and phone-flow tests demonstrate the completed behavior.

## Blocked by

- Blocked by `002-capture-note-in-timeline.md`

## What to build

Deliver the first complete event-documentation walking skeleton: a clinician can add a timestamped note from the fixed quick-action bar, see it immediately in the newest-first timeline, reopen and revise the same canonical entry, refresh without losing progress, and reset the prototype to its original synthetic state.

## Acceptance criteria

- [ ] The fixed quick-action area remains reachable and creates a timestamped note.
- [ ] The note appears immediately in the newest-first timeline with its clinical time and summary.
- [ ] Tapping the timeline row opens the note for editing and updates that same entry rather than creating a duplicate.
- [ ] A visible affordance allows the clinical time to be corrected.
- [ ] Refreshing restores the in-progress note and encounter state from browser-local persistence.
- [ ] Reset removes visitor-entered documentation and restores the version-controlled scenario baseline.
- [ ] Relevant event-model, persistence, and phone-flow tests demonstrate the completed behavior.

## Blocked by

- Blocked by `001-open-synthetic-encounter.md`

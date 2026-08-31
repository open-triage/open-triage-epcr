## What to build

Let a clinician search the full pinned NEMSIS recommended procedure list and document one or more timestamped procedures, including the curated attempt and outcome details and NEMSIS-derived validation needed by the chest-pain scenario.

## Acceptance criteria

- [ ] The repository contains a compact local procedure asset with source URL, release/version, checksum, code, and display label provenance.
- [ ] The Procedure quick action searches the full pinned list responsively on the minimum phone viewport.
- [ ] Selecting a result preserves its code and presents an understandable clinical label.
- [ ] A clinician can record the configured procedure time, attempts, success/outcome, and applicable complication details.
- [ ] Multiple procedures appear as distinct timeline entries and reopen for canonical editing.
- [ ] Missing or invalid included values produce direct, NEMSIS-referenced errors; configured warnings are distinguishable and acknowledgeable later.
- [ ] The asset is bundled locally and no runtime request to NEMSIS is required.
- [ ] Relevant provenance, search, validation, persistence, and phone-flow tests demonstrate the completed behavior.

## Blocked by

- Blocked by `002-capture-note-in-timeline.md`

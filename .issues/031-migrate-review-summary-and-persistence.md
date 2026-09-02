# Migrate review, summary, and persistence

**Type:** AFK

## What to build

Make review, completion, summary, autosave, and compatibility handling operate on the canonical encounter document and JSON form profile. Version incompatibility must never silently reinterpret or destroy an encounter.

## Acceptance criteria

- [ ] Findings identify canonical group occurrences and element IDs and navigate to the configured field or event.
- [ ] Errors, warnings, acknowledgements, and summaries resolve constraints and presentation from the catalog and form profile.
- [ ] Browser persistence stores the canonical document with data-model, extension, and form-profile versions.
- [ ] Compatible upgrades preserve standard, unknown, and custom values.
- [ ] Incompatible records are quarantined without mutation, produce an actionable diagnostic, and remain available for raw export or explicit user-authorized reset.
- [ ] Continue editing, refresh recovery, completion, and reset operate on one canonical stored document.
- [ ] Relevant review, navigation, warning, upgrade, quarantine, recovery, persistence, summary, and end-to-end tests demonstrate the completed behavior.

## Blocked by

- Blocked by `030-drive-standard-form-from-json.md`

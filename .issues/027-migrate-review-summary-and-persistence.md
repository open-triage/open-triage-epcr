## What to build

Make review, completion, summary, autosave, and version handling operate on the canonical encounter document and standard-form profile. Every displayed finding and completed value must trace back to a catalog element, and saved data must not be silently reinterpreted when the model or form changes.

## Acceptance criteria

- [ ] Review findings identify canonical group occurrences and element IDs and navigate directly to the configured field or event.
- [ ] Blocking errors, warnings, acknowledgements, and completed summaries resolve constraints and presentation from the catalog and form profile.
- [ ] Browser persistence stores the canonical document with data-model, extension, and form-profile versions.
- [ ] Compatible upgrades preserve standard, unknown, and custom values; incompatible versions fail or reset with an explicit diagnostic and no silent reinterpretation.
- [ ] Continue editing, refresh recovery, completion, and reset all operate on one canonical stored document.
- [ ] Relevant review, navigation, warning, version-migration, persistence, summary, and end-to-end tests demonstrate the completed behavior.

## Blocked by

- Blocked by `026-drive-standard-form-from-json.md`

# Establish a neutral standard encounter

**Status:** Completed — merged in PR #51.

## What to build

Establish one clinically neutral standard encounter throughout the active application so form behavior, persistence, validation, and documentation no longer encode or depend on a complaint category. Replace category-specific definition identities and synthetic scenario assumptions with neutral names and data while preserving the accepted phone workflow.

## Acceptance criteria

- [ ] Production filenames, exported symbols, definition IDs, storage keys, labels, validation messages, and active documentation use clinically neutral encounter terminology.
- [ ] No field, rule, quick action, review group, or summary behavior is enabled or altered according to a complaint or clinical category.
- [ ] The bundled synthetic encounter remains clearly fictional but does not establish a clinical-category-specific form.
- [ ] Existing category-named browser state is safely reset or migrated without silently reinterpreting it as the neutral encounter.
- [ ] Automated repository checks prevent category-specific form assumptions from being reintroduced into active source and configuration.
- [ ] Relevant unit, persistence, and phone-flow tests demonstrate the unchanged clinically neutral journey.

## Blocked by

None - can start immediately

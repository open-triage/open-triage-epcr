## What to build

Prove that the canonical NEMSIS data model is comprehensive, inspectable, extensible, and safe as the long-term basis for OpenTriage patient data. Automate source drift detection, demonstrate configuration-only extension, and exercise the complete phone and interchange journey from one canonical record.

## Acceptance criteria

- [ ] Automated checks compare catalog element and enumeration coverage with the pinned official EMSDataSet sources and fail on omissions or unexplained additions.
- [ ] Regenerating the catalog from identical sources produces byte-for-byte identical human-readable JSON.
- [ ] A reviewer can trace any configured field from form profile to catalog definition to canonical value and exported JSON/XML without consulting component code.
- [ ] A test-only custom element flows through configuration, capture, validation, persistence, review, summary, JSON interchange, and NEMSIS custom XML without application-code changes.
- [ ] Production artifacts contain the pinned standard catalog and neutral standard form but exclude test-only profiles and custom definitions.
- [ ] Documentation explains source updates, catalog regeneration, form authoring, custom-element authoring, compatibility policy, and interchange guarantees.
- [ ] Full unit, type-check, lint, build, accessibility, minimum-viewport, persistence, and interchange suites demonstrate the completed architecture.

## Blocked by

- Blocked by `028-add-portable-interchange.md`

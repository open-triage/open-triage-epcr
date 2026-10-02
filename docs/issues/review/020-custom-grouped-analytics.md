<!-- review:slice-020 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-51, US-52, US-54, US-55, US-56, US-57.

## What to build

Extend custom-field discovery and BI query behavior to repeated and grouped custom elements using the established long rows and per-report reducers. Preserve relationships to the correct parent clinical entries through projection, amendments, and filtering.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Repeated and grouped custom fields are discoverable and support only datatype-appropriate grouping/filtering/reduction operations.
- [ ] Rows retain stable group, parent, correlation, ordinal, applicable time, definition, and occurrence identity; values under different medication/assessment entries are not merged into an invented group.
- [ ] Category deduplication and numeric reducers preserve the report counting unit, including several custom groups within one report.
- [ ] Effective add/replace/remove amendments, retired pinned definitions, privacy classification, and absence/pertinent-negative states survive projection and analysis.
- [ ] Existing custom long rows and rebuilt standalone rows have one authoritative query path; replay creates no duplicate occurrences.
- [ ] Database/API and browser tests follow author-document-sign-project-analyze journeys across multiple parent entries and verify hand-calculated results and disclosure restrictions.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/660
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/661

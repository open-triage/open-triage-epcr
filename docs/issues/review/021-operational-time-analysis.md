<!-- review:slice-021 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-48, US-49, US-53, US-57, US-58.

## What to build

Provide the operational-time starter views and their supported built-in measures within the same basic analysis builder. Make the chosen canonical start/end fields, units, eligibility, and freshness explicit.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Users can open response, scene, and transport starter views and inspect their defined start/end timestamp mappings and units.
- [ ] Measures use effective signed data and the established per-report population/scope rather than creating a second reporting pipeline.
- [ ] Timestamp offsets, absent endpoints, reversed/inconsistent intervals, and approved quality/normalization rules are handled explicitly without silently altering source values.
- [ ] Grouping/filtering, numeric summaries, and result context remain compatible with the common analysis contract and later exports.
- [ ] These are named built-in measures; an arbitrary formula language or new clinical thresholds are not introduced.
- [ ] Fixture/API/browser tests verify interval arithmetic across timezone offsets, missing/invalid endpoints, signed corrections, visibility restrictions, and correct denominators.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/659

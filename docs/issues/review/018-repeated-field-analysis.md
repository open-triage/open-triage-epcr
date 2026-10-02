<!-- review:slice-018 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-48, US-50, US-51, US-52, US-53.

## What to build

Make repeated standard fields usable in the same basic builder without changing the patient-report counting unit. Deduplicate category membership per report and require an explicit first/last/minimum/maximum choice for repeated numeric values.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] A medication/category visualization counts each report once per category despite repeated occurrences, and explains non-exclusive categories whose percentages may total more than 100 percent.
- [ ] Repeated numeric analysis requires a per-report reducer and uses the resulting single report value for summaries.
- [ ] First/last ordering uses available occurrence/time metadata with documented deterministic ties and missing-time handling; non-temporal data is not silently described as a fabricated clinical timeline.
- [ ] Group/occurrence identity, exceptional values, scope, units, and privacy survive filtering and reduction.
- [ ] Result context records the chosen reducer and source values needed for later underlying-record export.
- [ ] Tests cover repeated doses, several categories per report, tied/missing timestamps, each reducer, and hand-calculated totals without report fan-out.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/659

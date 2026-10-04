<!-- review:slice-022 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-43, US-45, US-46, US-47, US-49, US-53.

## What to build

Preserve the review-workload API and review-criterion/outcome filters in the signed analytical API. Combine authorized review data with analytical report populations while keeping unsigned workload separate from signed clinical measures.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Workload API results summarize items by criterion, priority, status, age, and completion duration, with documented calculation/population definitions and history-aware re-review behavior.
- [ ] Overdue unsigned items and exceptional closure reasons are represented as workload; unsigned reports never enter signed clinical statistics.
- [ ] Clinical analyses can filter by matching review criteria and recorded outcomes without counting one patient report repeatedly because it has several review items.
- [ ] Workload item counts are clearly distinguished from patient-report counts and use their own permitted freshness context where appropriate.
- [ ] Scope, dataset, identifying restrictions, history-preserving outcomes, and analysis/export context are enforced across the review/clinical data boundary.
- [ ] Database/API tests cover several criteria per report, retrospective items, reopened reviews, overdue exceptions, cross-scope denial, and hand-calculable totals.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/653
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/655
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/656
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/659

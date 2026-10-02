<!-- review:slice-010 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-6, US-24, US-25, US-26, US-27, US-33.

## What to build

Add queue selection and bulk claim/assignment/reassignment using the same individual-item authority, eligibility, independence, and concurrency checks. Report which selected items succeeded or could not be changed.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Review-all can bulk self-claim eligible unassigned selections; review-admin can bulk assign/reassign selected items to an eligible reviewer.
- [ ] Every selected item is checked independently for current scope, state, assignee eligibility, and independent-review requirements.
- [ ] Partial failures and stale selections return clear per-item results without overwriting concurrent assignments or implying all selected work changed.
- [ ] Each successful mutation has attributable durable history and replay-safe behavior.
- [ ] Bulk completion is absent; completion remains an individual review action.
- [ ] API/database and browser tests cover mixed-authority selections, concurrent changes, independent-review exclusions, and accurate result reporting.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/648
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/651

<!-- review:slice-011 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-21, US-35, US-36, US-37, US-57, US-68.

## What to build

Reconcile signed amendments with existing review items. Reopen completed items for their assigned reviewer when relevant information changes and the criterion still matches; apply the agency's configured closure behavior when the criterion clears.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] A relevant changed input, including occurrence membership and absence states, reopens the existing completed report-criterion item when the report still matches; unrelated changes leave it closed.
- [ ] The prior conclusion, evidence, rule version, and comments remain visible in history, and relevant changes are highlighted subject to privacy restrictions.
- [ ] The existing assignee receives re-review when eligible; otherwise the established unassigned recovery path is used.
- [ ] Agency configuration defaults to reviewer-confirmed closure when an amendment clears a criterion and supports automatic closure with an attributable policy reason.
- [ ] Evaluation uses effective signed amendments and precise lineage; replay does not repeatedly reopen or close the same evidence.
- [ ] Tests cover relevant/irrelevant changes, add/replace/remove occurrences, both clearance policies, concurrent decisions, retained history, and ineligible assignees.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/649
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/651

<!-- review:slice-012 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-38, US-39, US-40, US-41, US-42, US-47.

## What to build

Deliver the special unsigned-report workflow from scheduled overdue detection to a usable scoped review item and automatic resolution after signing. Provide the agency deadline setting and authorized read-only access to an eligible overdue draft.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] The default deadline is 24 hours after call completion, falling back to report creation; the agency can configure it, and ordinary edits do not restart the clock.
- [ ] A bounded repeatable scheduler creates one overdue follow-up per report, with assignment, permitted draft inspection, status, and history in Review.
- [ ] Operational draft reads enforce report scope and identifying restrictions; ordinary unsigned drafts remain outside signed clinical analytics and ordinary criterion evaluation.
- [ ] Signing closes the overdue item with Resolved by signing, preserves history, and triggers ordinary signed-report criteria.
- [ ] Cancelled calls follow the ordinary cancelled-disposition-and-signature path; a cancellation event alone does not close an unsigned item.
- [ ] Controlled-clock database/API/browser tests cover boundary times, missing completion, edits, scheduler retry, signing races, authorization, and signed cancellation.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/648
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/649

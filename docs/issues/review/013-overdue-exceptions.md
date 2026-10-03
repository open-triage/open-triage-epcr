<!-- review:slice-013 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-43, US-47.

## What to build

Let review-admin close an overdue follow-up exceptionally without signing, requiring an attributable reason and retaining the report's unsigned state for workload reporting.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Only review-admin can use the exceptional unsigned closure action, and a recorded reason is mandatory.
- [ ] The action closes the review follow-up, preserves unsigned clinical state and prior history, and does not delete or sign the report.
- [ ] The recorded reason respects identifying restrictions; permitted structured exception information remains available for workload statistics.
- [ ] Routine scheduler reruns do not immediately recreate the same exceptionally closed item; a later signature is reconciled without corrupting its recorded history.
- [ ] Tests cover unauthorized or reasonless closure, successful exception, replay/concurrency, unchanged clinical state, and later signing.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/654

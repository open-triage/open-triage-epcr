<!-- review:slice-005 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-24, US-28, US-30.

## What to build

Let a review-all user claim an eligible unassigned item from its queue row or detail and see the assignment persist in the queue and history. Establish the versioned assignment command used by subsequent workflow slices.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Only an authorized review-all user can claim an eligible unassigned item for themselves; the command does not broaden report access.
- [ ] The assignee and assignment history update durably and are visible consistently on queue and detail views.
- [ ] Concurrent claims have one winner, with a recoverable conflict for other claimants; replay of an accepted command does not duplicate history.
- [ ] Claiming does not allow reassigning another reviewer or completing an item before the appropriate workflow exists.
- [ ] Database/API and browser tests cover successful claim, scope denial, stale state, replay, and concurrent claim ownership.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/646

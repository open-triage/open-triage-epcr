<!-- review:slice-007 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-27, US-28, US-29, US-30, US-32.

## What to build

Let assigned reviewers progress an item through the agreed fixed statuses and complete it with an agency-configured outcome. Provide review-admin outcome configuration while preserving the meaning of historical conclusions.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] New, In review, Awaiting clinician, and Completed are available through authorized transitions; completion requires a configured outcome and is performed one item at a time.
- [ ] Only the current assigned reviewer can complete an item or change its outcome; administrators take over through reassignment.
- [ ] Review-admin can configure outcome choices, with used historical labels/meaning preserved when an outcome is revised or retired.
- [ ] Clinicians and other authorized readers can see permitted statuses/outcomes on their reports while the review progresses.
- [ ] Every accepted status/completion/outcome change is attributable and versioned; stale commands conflict and retries do not duplicate history.
- [ ] Source reports remain unchanged, and API/database/browser tests cover complete workflow, outcome evolution, unauthorized completion, concurrency, and history.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/647

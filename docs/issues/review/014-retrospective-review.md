<!-- review:slice-014 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-19, US-20, US-21, US-22, US-68.

## What to build

Give review-admin a date-bounded preview and deliberate execution workflow for selected published criteria. Show expected new work and existing items, process bounded resumable batches, and expose incompatible or failed evaluations.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Preview binds criterion/version selection, date range, dataset, and authorized report scope and reports matches, existing items, and failures/incompatibilities.
- [ ] Only an authorized deliberate run creates work; publishing or previewing alone does not populate historical items.
- [ ] Execution rechecks authorization and reports changed selections/populations instead of silently claiming an obsolete preview is exact.
- [ ] Runs are bounded, resumable, and observable through the Review administration interface; interruption and retry do not duplicate report-criterion items.
- [ ] Existing workflow conclusions/history are preserved when attaching later evaluation evidence; retrospective execution does not introduce unapproved automatic resets of completed reviews.
- [ ] Tests cover date boundaries, multiple catalog versions, duplicate runs, interruption/resume, scope changes, configuration changes, and failure recovery.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/648
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/649

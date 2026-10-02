<!-- review:slice-008 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-9, US-28, US-31, US-32.

## What to build

Add the shared timestamped discussion to review detail so reviewers can request a clinician response and permitted participants can respond in context before completion. Apply the agreed identifying boundary to free-text discussion.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Authorized participants can contribute attributed, timestamped comments on a review item, and the clinician can see permitted discussion on their own reports throughout review.
- [ ] The assigned reviewer can place work in Awaiting clinician and follow the response in the same review context.
- [ ] Unrestricted review comments are treated as potentially identifying; record/comment APIs enforce the agreed identifying restriction without hiding permitted structured statuses/outcomes.
- [ ] Response or comment submission does not grant completion, reassignment, or independent-review authority.
- [ ] Discussion history and permissions remain correct across reload, concurrent responses, access revocation, and re-review.
- [ ] API and browser journeys cover reviewer request, clinician response, immediate permitted visibility, and denial of restricted free text.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/649

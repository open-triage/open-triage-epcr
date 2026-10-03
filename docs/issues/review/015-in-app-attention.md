<!-- review:slice-015 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-34, US-44, US-68.

## What to build

Connect review assignments, requested responses, and re-review to counts and indicators on the Review selector and queues. Keep the indicators aligned with current authorized actionable work.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Users see in-app indicators for new assignments, requested clinician responses, and reopened items, with navigation to the corresponding authorized work.
- [ ] Priority and age remain visible; no general deadline/escalation behavior is introduced.
- [ ] Counts and indicators update after claim, reassignment, response, completion, automatic closure, and permissions changes without leaking inaccessible reports.
- [ ] Unavailable-assignee and processing-failure administrative indicators remain reachable through the relevant management views.
- [ ] No email provider, outbound email, or external notification integration is required.
- [ ] API/browser tests cover the lifecycle of each indicator and negative scope/revocation cases.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/650
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/653
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/654

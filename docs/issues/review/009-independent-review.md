<!-- review:slice-009 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-23, US-30, US-33.

## What to build

Make independent review an explicit criterion workflow setting separate from priority, and enforce it throughout routing, claims, reassignment, and completion. The documenting clinician can still provide permitted responses.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] An appropriately authorized criterion manager can configure independent review through review configuration without editing a shared rule's clinical assertion or severity.
- [ ] When enabled, the documenting clinician cannot claim, be routed as the completing reviewer, or complete the item; invalid routing combinations receive an actionable explanation.
- [ ] An eligible different reviewer can receive and complete the item, while the clinician retains their permitted report and feedback access.
- [ ] Server checks apply to direct commands, stale configuration, and reassignments; a UI-only restriction is insufficient.
- [ ] Tests cover routing to the author, self-claim, direct completion, eligible independent completion, priority independence, and configuration changes.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/648
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/649

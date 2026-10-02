<!-- review:slice-006 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-6, US-7, US-23, US-25, US-68.

## What to build

Give review-admin a usable assignment and routing screen: route future items to the documenting clinician, a named eligible reviewer, or the unassigned queue; assign and reassign existing items with durable attribution. Recover explicitly when a configured or current assignee becomes ineligible.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Review-admin can set per-criterion routing without gaining validation write/publish permissions; a new criterion defaults to unassigned.
- [ ] Each routing option is exercised by signing a matching report and observing its actual queue assignee.
- [ ] Review-admin can assign/reassign an item, while review-all alone can only self-claim eligible unassigned work.
- [ ] Named/default assignees must have current report access, active eligibility, and any applicable independence eligibility; assignment is never a permission grant.
- [ ] If a current or configured assignee becomes ineligible, work returns to the unassigned queue with preserved history and an administrative indicator.
- [ ] Optimistic concurrency and durable history prevent silent overwrite of assignment decisions.
- [ ] Database/API/browser tests cover all routing options, capability separation, reassignment, role loss/disablement, and recovery.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/647

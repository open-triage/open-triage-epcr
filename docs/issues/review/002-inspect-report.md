<!-- review:slice-002 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-2, US-4, US-5, US-8, US-9, US-17, US-32, US-57.

## What to build

Open a report from Review and inspect its effective signed content using the current report presentation and pinned catalog definitions. Apply the review access boundary to standard/custom values, free text, notes, photos, and audio through their actual retrieval paths.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] The reviewer can open any eligible signed report in their scope, including an unflagged own report, and inspect effective signed amendments with the correct definition labels and occurrence context.
- [ ] Identifying content is revealed only with review-identifying plus report scope; without it, identifying fields, unrestricted clinical text, photos, and audio are withheld on the server.
- [ ] Direct report/media requests enforce the same boundary as navigation, including previously obtained IDs and permission revocation.
- [ ] Grouped custom values remain attached to the correct clinical entry; rendering is not limited to whichever fields happen to appear on the latest form.
- [ ] Read-only review does not change the signed record or grant clinical editing/signing authority.
- [ ] API and representative browser tests cover identified/non-identifying access, custom grouping, effective amendments, and direct-request denial.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/643

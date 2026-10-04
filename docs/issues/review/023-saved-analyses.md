<!-- review:slice-023 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-59, US-60, US-61.

## What to build

Preserve the stored-definition API for personal definitions and review-admin publication of shared definitions. Every open or refresh evaluates the definition under the current viewer's own permissions and selected authorized dataset.

Deliver the persistence/contracts, authorized API behavior, backend integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] The API supports saving, naming, reopening, and updating personal definitions using the validated definition contract.
- [ ] Only review-admin can publish/manage shared definitions; sharing does not persist another user's result rows as a source of authority.
- [ ] Two users opening the same shared definition see their own authorized report populations and identifying fields.
- [ ] Revoked access, retired/unavailable fields, incompatible definitions, and unauthorized dataset/field references produce clear errors without silently widening or changing the analysis.
- [ ] Personal/shared definition persistence and updates respect organization ownership and concurrency.
- [ ] API tests cover private ownership, authorized publication, cross-user shared evaluation, role revocation, and stale definitions.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/659

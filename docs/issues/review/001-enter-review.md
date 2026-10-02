<!-- review:slice-001 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-1, US-2, US-3, US-4, US-5, US-8, US-9, US-10, US-11, US-12, US-13, US-66.

## What to build

Add the online Review mode with a paginated signed-report list that can actually be used by the new roles. A clinician sees their documented reports, a Reviewer sees eligible organization reports, and the demo fixture enters the synthetic dataset with all three requested review capabilities. This slice owns the shared authorization/context contract reused by later slices.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Review appears only for a usable review scope; identifying permission alone does not expand report scope. Review-only roles do not accidentally gain Admin mode through the existing broad non-clinical-capability check.
- [ ] Register capabilities consistently with the existing registry; update Clinician, enable Reviewer, provide Review administrator, and give the demo role review-all, review-admin, and review-identifying through durable roles.
- [ ] The signed-report list enforces current organization and own/all scope on the server, is paginated, and exposes only permitted summary fields. Assignment is not required to browse one's own signed reports.
- [ ] Real and synthetic populations are separately selectable within authorization; ordinary users default to real data and the demo user to synthetic data.
- [ ] Mode persistence, offline unavailability, supported localization, and feedback-mode integration work with the existing shell.
- [ ] API/database role tests and a browser journey cover cross-user/organization denial, role defaults, revocation, dataset isolation, demo bootstrap, and Review-only navigation.

## Blocked by

None - can start immediately

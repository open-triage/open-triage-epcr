<!-- review:slice-016 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-3, US-4, US-5, US-8, US-9, US-45, US-48, US-49, US-50, US-58, US-66, US-67.

## What to build

Deliver the first real BI visualization: report counts over a selected period from existing signed analytics views, with own/all scope, real/synthetic selection, and visible freshness. Establish the small validated analysis/result contract later measures and exports will reuse.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] The user can view a report-volume trend in Review with a date filter and one time grouping; all eligible signed reports are included regardless of review assignment or criterion match.
- [ ] Multiple patient reports in one incident count separately, and the interface identifies the counting unit.
- [ ] Backend queries enforce organization, documenting-user, dataset, and identifying rules using suitable scoped metadata and explicit least-privilege analytical access; private projections are not made generally accessible.
- [ ] The existing projector populates any required stable scope/dataset metadata with effective amendment lineage, including replay of existing reports where necessary.
- [ ] The backend can use a configured reporting replica; the UI queries the API, shows freshness against the existing five-minute target, and supports refresh without presenting stale or failed projection as current.
- [ ] Analysis definitions/results carry validated filters and population/freshness context suitable for later matching exports.
- [ ] Database/API/browser tests cover own/all counts, cross-organization denial, real/synthetic separation, multiple reports per incident, stale projection, and supported reporting-role access.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/643

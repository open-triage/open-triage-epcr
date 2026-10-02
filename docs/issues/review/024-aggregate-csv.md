<!-- review:slice-024 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-62, US-64, US-65.

## What to build

Add aggregate CSV download to the common visualization experience. Export the displayed aggregate result with its definition, dataset, and freshness context rather than silently issuing a different unrestricted query.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Users can download aggregate CSV from supported visualizations, with values and denominators matching the displayed authorized result.
- [ ] CSV context identifies real/synthetic dataset, measure, filters, grouping/reducer where applicable, and data freshness.
- [ ] Current authorization is rechecked; inaccessible fields, stale capability grants, and cross-organization result references cannot be exported.
- [ ] If source changes require a refreshed result, chart and export are refreshed coherently and visibly rather than presenting mismatched populations.
- [ ] Serialization handles quoting, delimiters, newlines, and formula-like user-authored text safely, and never silently truncates a completed export.
- [ ] API/browser tests compare parsed CSV to displayed hand-calculated results and cover revocation, source updates, hostile cell content, and multiple measure types.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/659

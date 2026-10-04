<!-- review:slice-017 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-9, US-45, US-48, US-49, US-53.

## What to build

Support permitted single-valued standard fields, filters, grouping, categorical distributions, percentages, and numeric summaries. The [Unified analytics workspace PRD](../../prds/unified-analytics-workspace.md) defines the current interface.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Users can discover permitted standard fields, choose supported filters and one grouping, and display count/percentage or appropriate mean/median/minimum/maximum summaries.
- [ ] Field discovery, allowed operations, and actual queries all enforce scope and identifying/free-text restrictions; crafted requests cannot access prohibited fields.
- [ ] Complaint, clinical impression, and disposition are expressible by the same analysis definition model.
- [ ] Results expose denominator and missing/absence counts where relevant, never convert missing data to zero, and do not combine incompatible units silently.
- [ ] Queries are bounded and parameterized, use the existing approved source/normalization policy, and show unsupported operations as explicit errors.
- [ ] Hand-calculable API/database fixtures and browser tests verify each supported operation, filters, null/absence handling, units, and authorization.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/658

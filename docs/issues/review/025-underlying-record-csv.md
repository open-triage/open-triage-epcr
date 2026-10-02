<!-- review:slice-025 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-9, US-50, US-51, US-52, US-54, US-56, US-57, US-63, US-64, US-65, US-67.

## What to build

Add the companion record-level CSV export for each supported visualization, preserving the displayed population, values, reductions, and data version across standard/custom and clinical/workload analyses. Complete bounded export processing that remains consistent as projections and review outcomes change.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Underlying exports contain one row per contributing patient report, with selected permitted structured fields and values needed to explain the displayed result; workload exports retain contributing review-item details in a documented structured cell representation without multiplying report rows.
- [ ] Repeated categorical values have a documented stable cell representation without multiplying report rows, and repeated numeric fields use the visualization's reducer.
- [ ] Custom field identities/group relationships, effective amendment state, operational-time inputs, missing values, and real/synthetic context remain interpretable.
- [ ] Aggregates and underlying rows reconcile against the same authorized analysis context even when projection or review data changes between display and download; use a coherent version boundary or an explicit coordinated refresh.
- [ ] Authorization is rechecked for generation and retrieval, including scope and identifying restrictions; cached/generated results never preserve revoked access.
- [ ] Large exports use bounded complete processing, explicit progress/failure where needed, and no silent truncation or unrestricted private-table access.
- [ ] Database/API/browser tests cover every supported visualization family, a source-update race, private field denial, CSV safety, and export completeness at representative supported volumes.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/660
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/662
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/663
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/664
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/666

<!-- review:slice-003 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-14, US-15, US-19.

## What to build

Extend the existing validation authoring journey so a review-target rule has a published High, Medium, or Low review priority independently of its Error, Warning, or Information severity. Keep the existing rule language, immutable bundles, and read/write/publish authority.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Authorized authors can create, edit, validate, publish, and inspect review priority in the existing rule editor and rule listing.
- [ ] A rule used for documentation/signing and review can have independent severity and review priority; publication preserves both without changing assertion semantics.
- [ ] Existing published versions remain immutable and readable; legacy review rules without an explicit priority have documented compatibility behavior rather than failing silently.
- [ ] Review-admin does not grant validation authoring/publication, and new publication alone does not scan historical reports.
- [ ] Contract, publication/API, and browser tests prove priority round trips, capability separation, historical compatibility, and independent signing behavior.

## Blocked by

None - can start immediately

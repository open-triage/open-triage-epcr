<!-- review:slice-004 -->

Parent PRD: https://github.com/open-triage/open-triage-epcr/issues/642  
Implementation branch: feature/review  
Type: **AFK**  
User stories covered: US-16, US-17, US-18, US-19, US-21, US-22, US-34, US-68.

## What to build

Deliver the first complete signing-to-review path: a signed report is evaluated by durable bounded processing and appears in the Review queue with criterion evidence and priority. Store immutable evaluation lineage separately from the item's mutable workflow, and expose failed processing to authorized review administrators.

Deliver the persistence/contracts, authorized API behavior, UI or operational integration, and behavioral tests needed for this specific journey. Follow the parent PRD's organization scope, identifying restrictions, real/synthetic separation, current UI/localization conventions, immutable clinical history, and basic-BI boundary. Apply relevant repository instructions and skills during implementation.

## Acceptance criteria

- [ ] Signing a matching report produces one New, initially unassigned item per stable report-criterion identity; several matching occurrences are retained in one item, and different criteria produce separate items.
- [ ] Only applicable published review-target rules run, with existing assertion/finding semantics and exact signed-state, amendment, rule-version, and evaluation-time lineage.
- [ ] Review processing is retryable and independent of successful clinical signing; duplicate events, concurrent workers, replay, and repeated evaluations cannot duplicate items or evidence for the same work.
- [ ] The queue supports supported criterion/priority/status/date filters, pagination, priority highlighting, age, and opening the scoped report with its relevant findings.
- [ ] Unsigned drafts are excluded from ordinary evaluation; catalog incompatibility and execution failure are explicit unevaluated/failed outcomes rather than passes.
- [ ] The existing explicit review-evaluation endpoint also enforces the new report scope; validation-read authority alone cannot bypass review access restrictions.
- [ ] A deployable bounded worker/schedule and an authorized failure/backlog view or equivalent existing operational integration make failed runs observable and recoverable.
- [ ] Database/API/browser tests demonstrate author-publish-sign-queue behavior, multiple criteria/occurrences, retries, failures, authorization, and preservation of signed data.

## Blocked by

- Blocked by https://github.com/open-triage/open-triage-epcr/issues/643
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/644
- Blocked by https://github.com/open-triage/open-triage-epcr/issues/645

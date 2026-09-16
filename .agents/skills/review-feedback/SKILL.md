---
name: review-feedback
description: Review feedback stored by an OpenTriage installation, investigate the relevant evidence and code, summarize every open item, and recommend triage and implementation actions. Use for requests to review, inspect, summarize, triage, or address submitted user feedback. Apply decisions or implement fixes only when the user separately authorizes those actions.
---

# Review Feedback

Use the repository's guarded feedback-review workflow for one OpenTriage
installation at a time.

In the first response, state the inferred instance, such as `local` or `public
demo`. Prefer an explicit target, then clear conversation context. Clarify only
when the target remains ambiguous or conflicts with the sanitized connection
host/database. Never expose credentials or a connection URI.

For every invocation, read [the review workflow](references/review.md)
completely before accessing feedback. It defines target resolution, the
read-only interface, required evidence, recommendations, authorization gates,
and safe reporting.

When the user explicitly authorizes implementing an item, also read [the
implementation cycle](references/implementation-cycle.md) completely before
editing. It defines automated and local human validation, approval, commit, and
resolution gates.

Reviewing is read-only. Do not record a decision, edit code, create downstream
work, contact a submitter, or change any external system unless the user
separately authorizes that action. Preserve unrelated working-tree changes
during authorized implementation.

# User Feedback PRD

## Problem Statement

OpenTriage users currently have no direct way to report a bug or request a
feature from the interface where they encounter a problem or identify an
opportunity. Reports made outside the application tend to omit the application
version, presentation mode, browser conditions, visible UI state, and recent
failures needed to reproduce a bug. Asking users to collect that information
manually would make feedback slower and less reliable.

The application can contain patient, clinical, operational, identity, and
session information. Capturing a screenshot, raw HTML, network payload, or
unfiltered browser state would therefore create an unacceptable disclosure
risk. Free-form feedback creates a separate residual risk because a user can
type identifying information even when the application does not collect it
automatically.

The maintainers also need a repeatable way to review submissions with AI
assistance while preserving human control over priorities, status changes,
external issue creation, and implementation. A full user-facing issue tracker
or administrative feedback inbox is not needed for the initial workflow.

## Solution

Add a bug-icon feedback control as the first action in the authenticated blue
session bar for every server-backed installation. The control opens an
accessible dialog in which the user explicitly chooses Bug or Feature and
provides one required description using a type-specific prompt. The interface
warns the user not to include patient-identifying information, submits online
through the authenticated API, and returns a short reference code.

For a bug report, the browser captures a bounded diagnostic snapshot immediately
before opening the dialog. The snapshot describes the application build,
current screen and presentation mode, browser and viewport, connectivity,
value-free UI structure, recent value-free interaction names, and recent
sanitized request failures. For a feature request, only lightweight environment
context is attached. Screenshots, raw DOM, entered values, clinical text,
record identifiers, request or response bodies, headers, cookies, credentials,
tokens, and keystrokes are never submitted.

Each installation stores its own feedback in a private PostgreSQL schema. The
original submission remains immutable, review decisions are append-only, and
diagnostics are removed 30 days after a terminal decision while the submission
and approved review history remain available. A documented internal CLI lets an
AI reviewer list and inspect sanitized submissions, propose non-mutating triage,
and record only decisions explicitly approved by a human. The initial release
does not expose a feedback inbox or status tracker in the application and does
not perform unattended AI review or external repository actions.

## User Stories

1. As an authenticated OpenTriage user, I want a consistently placed feedback control, so that I can report a problem or idea without leaving my current workflow.
2. As a Mobile user, I want the feedback control available without losing the existing Refresh action, so that reporting feedback does not impede call work.
3. As a Stationary user, I want the same feedback entry point, so that I can report issues specific to the desktop documentation experience.
4. As an administrator, I want the same feedback entry point in Admin mode, so that configuration problems and ideas can be reported in context.
5. As a keyboard or assistive-technology user, I want the bug icon to have an accessible name and tooltip, so that its purpose is clear without relying on the icon alone.
6. As a user, I want to choose explicitly between Bug and Feature, so that my submission is classified correctly.
7. As a user reporting a bug, I want a prompt asking what happened and what I expected, so that I can provide actionable information in one concise field.
8. As a user requesting a feature, I want a prompt asking what I want to do and why, so that maintainers can understand the intended outcome.
9. As a user, I want a warning not to enter patient-identifying information, so that I understand the boundary before writing feedback.
10. As a user, I want a clear message-length limit, so that I know how much detail can be submitted.
11. As a user, I want the application to prevent empty feedback, so that accidental blank submissions are avoided.
12. As a user, I want the Submit action to show that delivery is in progress, so that I do not submit repeatedly while waiting.
13. As a user, I want a confirmation and short reference code after successful submission, so that I know the report was received.
14. As a user, I want my text preserved when submission fails, so that I can retry without rewriting it.
15. As a user, I want repeated retries of one submission to create at most one record, so that a slow or interrupted response does not create duplicates.
16. As an offline user, I want a clear indication that feedback submission requires a connection, so that delivery behavior is predictable.
17. As a user, I want canceled feedback and its pending diagnostic snapshot discarded, so that unfinished reports are not retained.
18. As a user reporting a bug, I want relevant technical context attached automatically, so that I do not need to understand or collect diagnostic details.
19. As a user requesting a feature, I want only lightweight technical context attached, so that unrelated interface structure and interaction history are not collected.
20. As a user, I want diagnostic capture failure not to block my report, so that a problem in the diagnostic helper can itself still be reported.
21. As a user, I want entered field values and visible clinical or identity text excluded from diagnostics, so that the feedback system does not copy application content.
22. As a user, I want elements covered by the approved identifiable-element policy excluded, so that the established privacy boundary also governs feedback diagnostics.
23. As a user, I want credentials, session tokens, cookies, headers, and network bodies excluded, so that feedback cannot disclose authentication material.
24. As a maintainer, I want the current application version, mode, screen, browser family, viewport, and connectivity state, so that I can reproduce environment-specific bugs.
25. As a maintainer, I want a value-free structural snapshot of the pre-dialog interface for bug reports, so that I can understand the rendered state without receiving raw HTML.
26. As a maintainer, I want up to 20 recent interaction names without values or identifiers, so that I can understand the path to a bug without recording user input.
27. As a maintainer, I want up to 10 recent failed requests with normalized endpoint patterns, status, duration, and timestamp, so that API failures can be diagnosed without receiving record content.
28. As an installation operator, I want feedback stored in the installation's own database, so that the feature does not silently transmit organizational metadata to a central service.
29. As an installation operator, I want the feedback schema isolated from clinical and identity data, so that its purpose and privileges remain clear.
30. As an installation operator, I want authenticated users to create submissions without gaining feedback-list access, so that one user cannot browse another user's reports.
31. As an installation operator, I want per-user submission limits, so that accidental flooding and basic abuse are bounded.
32. As a reviewer, I want submissions attributed to the authenticated user and organization, so that I can understand installation context and recognize repeated reports.
33. As a reviewer, I want submission-time display-name snapshots without credentials or contact data, so that attribution remains understandable after account changes.
34. As a reviewer, I want the original type, text, attribution, and submission time preserved unchanged, so that later review never rewrites what the user reported.
35. As a reviewer, I want to classify submissions as new, triaged, planned, in progress, resolved, declined, or duplicate, so that the queue has a consistent lifecycle.
36. As a reviewer, I want to assign low, normal, high, or urgent priority during review, so that users do not need to judge operational priority themselves.
37. As a reviewer, I want duplicate submissions linked to a canonical submission, so that related reports remain discoverable without parallel work.
38. As a reviewer, I want a summary, review note, and optional external issue or pull-request link, so that decisions and downstream work remain connected.
39. As a reviewer, I want every review decision recorded as an append-only event, so that AI and human changes are auditable and reversible through later events.
40. As a reviewer, I want AI events to identify the reviewer type, model, review run, and time without storing hidden reasoning, so that automated assistance has useful provenance.
41. As a human decision-maker, I want AI triage to remain non-mutating until I approve a decision, so that the AI cannot determine product priorities by itself.
42. As a human decision-maker, I want issue creation, branch creation, pull requests, and implementation to require separate explicit instructions, so that intake does not trigger external actions.
43. As an AI-assisted reviewer, I want a documented CLI for listing, filtering, and inspecting sanitized submissions, so that later review sessions can follow a repeatable workflow.
44. As an AI-assisted reviewer, I want cursor-based queue traversal, so that review remains stable as submissions accumulate.
45. As an AI-assisted reviewer, I want review proposals to be read-only by default, so that analysis cannot accidentally mutate the queue.
46. As an AI-assisted reviewer, I want approved writes to require explicit status, priority, and note arguments, so that each recorded decision is intentional.
47. As a human decision-maker, I want bulk review changes to require an additional confirmation control, so that a broad mistake is harder to make.
48. As an installation operator, I want diagnostics deleted 30 days after a terminal decision, so that temporary troubleshooting context is not retained after it is useful.
49. As a maintainer, I want the original submission and approved review history retained after diagnostic deletion, so that product decisions and resolution history remain available.
50. As an installation operator, I want the feedback feature omitted from static browser-only builds, so that the interface does not promise delivery where no trusted API or database exists.

## Implementation Decisions

### Feedback Capture UI

- Add a bug-icon feedback control as the first control in the authenticated blue session bar, before Refresh in clinical modes and in place of the current Admin placeholder arrangement.
- Make the control available to all authenticated users in Mobile, Stationary, and Admin modes when the browser is connected to the server-backed API.
- Do not display the control in the static browser-only prototype, on the unauthenticated sign-in screen, or during forced password replacement.
- Give the icon an accessible name and tooltip. Preserve predictable dimensions and responsive behavior in the already dense session bar.
- Open an accessible modal dialog with focus management, Escape and Cancel behavior, status announcements, and focus restoration to the trigger.
- Require an explicit Bug or Feature selection through a two-option segmented control. Do not preselect a type merely because the entry control uses a bug icon.
- Use one required text area. For Bug, prompt for what happened and what was expected. For Feature, prompt for the desired capability and its purpose.
- Trim input, reject an empty message, and enforce a 4,000-character maximum in both client and server validation.
- Show a warning not to include patient-identifying information. Do not claim that arbitrary free text is automatically redacted.
- Treat stored feedback as non-sensitive application data for this release, while still restricting access according to least privilege.
- Keep diagnostics hidden from the submitting user; no diagnostic preview or removal control is required.
- Keep submission online-only. Do not persist pending feedback or diagnostics in local storage, IndexedDB, the service worker, or another offline queue.
- Disable Submit while a request is pending. On success, close the dialog and announce a short opaque reference code. On failure, retain the selected type and text and offer retry.
- Generate one idempotency key per opened feedback draft and reuse it for retries. Discard the key and all in-memory capture state on cancel or confirmed success.

### Sanitized Diagnostics Collector

- Encapsulate diagnostic collection behind a small typed interface that returns either a versioned diagnostic payload or an unavailable result with a safe failure category.
- For Bug, capture the current interface immediately when the feedback control is activated and before the dialog alters the page. Hold the result in memory only until cancel or submission.
- For Feature, omit the structural snapshot, interaction trail, and failed-request history. Include only app/build version, current mode and screen, browser family, viewport, connectivity, and diagnostic schema version.
- For Bug, include the lightweight context plus a value-free structural description, no more than the 20 most recent permitted interaction names, and no more than the 10 most recent permitted failed-request summaries.
- Define interaction names as application-authored semantic actions. Never derive them from keystrokes, input events, field values, visible record identifiers, request payloads, or response payloads.
- Define failed-request summaries as timestamp, HTTP method, normalized endpoint pattern, status code, and duration. Replace path identifiers and query values with placeholders.
- Never collect screenshots, raw DOM, raw HTML, input or textarea values, selected clinical values, visible clinical/user text, record identifiers, request or response bodies, headers, cookies, authorization data, session tokens, credentials, stack-local secrets, or keystrokes.
- Apply the approved identifiable-element policy when traversing rendered clinical structures. Exclude covered nodes rather than attempting to redact their content after serialization.
- Treat custom elements and unclassified content conservatively: retain structure only when it can be represented without value-bearing text or attributes.
- Convert browser state directly into a versioned allowlisted schema. Raw DOM must never be serialized or sent to the API.
- Permit only explicitly approved element/component markers, state categories, classes, roles, and bounded metadata. Exclude arbitrary attributes, text nodes, generated IDs, URLs, and dataset contents.
- Bound the complete encoded diagnostic payload with a server-enforced maximum. A capture or validation failure yields `diagnostics_status: unavailable` and does not block the feedback submission.
- Maintain bounded in-memory buffers for permitted interactions and request failures. Do not backfill history from browser logs or persisted application data.

### Feedback Submission API

- Add a versioned authenticated create endpoint under the existing NestJS API. Use the existing application session and CSRF protections rather than Supabase Auth or a browser-direct database client.
- Derive user and organization attribution from the verified server session. Ignore or reject client-supplied actor, organization, display-name, status, priority, or review fields.
- Accept only the selected type, trimmed feedback text, idempotency key, diagnostic schema version, diagnostic status, and the appropriate allowlisted diagnostic payload.
- Enforce request and diagnostic size limits before persistence and reject unknown fields.
- Enforce five accepted submissions per authenticated user in a rolling hour. Return a user-safe retry response without exposing other submissions or internal counts.
- Make idempotency scoped to the authenticated user and installation. Replaying the same key returns the existing success result and reference code without inserting another submission.
- Persist the submission and optional diagnostic record atomically. Diagnostic unavailability must be a valid successful submission state.
- Return only the new submission's opaque reference code and success state. Do not expose sequential database identifiers.
- Do not add user-facing list, detail, update, or delete endpoints. Ordinary sessions receive no ability to read feedback records after creation.

### Feedback Persistence And Lifecycle

- Add a private `feedback` PostgreSQL schema outside the clinical, identity, analytics, and Supabase-exposed schemas. Revoke default `PUBLIC` access.
- Store immutable submission content separately from optional diagnostics and append-only review events. Keeping diagnostics in a separate record is an implementation inference that permits later deletion without mutating the preserved submission.
- Give submissions a database-local primary key and a separate opaque, unique, non-sequential user-facing reference code.
- Record type, original text, organization and user identifiers, submission-time organization and user display names, idempotency key, diagnostic status, diagnostic schema version, creation time, current review status, current priority, current approved summary/note, duplicate target, external link, terminal time, and update time as appropriately typed columns.
- Use timezone-aware timestamps and constrained text values for submission type, review status, priority, diagnostic status, and reviewer type.
- Use foreign keys for actor, organization, duplicate target, diagnostic ownership, and review-event ownership where compatible with the repository's account-retention rules. Index every foreign key used by joins or cleanup.
- Preserve submission attribution if an account is later deactivated. Do not couple feedback retention to clinical or account deletion workflows.
- Enforce uniqueness for the user-scoped idempotency key and user-facing reference code.
- Store diagnostics as validated versioned JSON only because their bounded shape may evolve. Do not add a broad JSON index unless an approved review query requires JSON predicates; normal review filtering uses typed columns.
- Constrain current status to `new`, `triaged`, `planned`, `in_progress`, `resolved`, `declined`, or `duplicate`.
- Constrain priority, when assigned, to `low`, `normal`, `high`, or `urgent`.
- Require a canonical-submission link for `duplicate` and prevent a submission from linking to itself.
- Treat `resolved`, `declined`, and `duplicate` as terminal for diagnostic retention. A later review event may reopen a submission, but deleting diagnostics is irreversible.
- Append a review event and update the current review projection atomically. Do not update original type, text, attribution snapshots, creation time, or reference code.
- Record each review event's resulting status and priority, approved summary and note, duplicate/external link changes, reviewer type, human reviewer ID when applicable, model identifier and review-run ID when applicable, and timestamp.
- Record AI provenance without storing full prompts, hidden reasoning, credentials, or unrelated conversation content.
- Add indexes that match the review queue: status and creation order, organization and creation order, type and creation order, and the terminal diagnostic-cleanup selector. Prefer a partial cleanup index for rows that still have diagnostics and are eligible by terminal time.
- Use stable cursor pagination ordered by creation time and a unique key. Do not use deep offset pagination in the internal review workflow.
- Give the application/API role only the minimum privileges needed for server-mediated creation. Give a non-login reviewer role only the reads and review-event/current-projection writes required by the documented CLI. Grant no direct content rewrite or deletion capability.
- Do not expose the private schema through Supabase Data API roles. The API remains the only user-facing writer.
- Add an idempotent retention operation that deletes diagnostics 30 days after terminal time while retaining the submission and review history. Repeated runs must be safe, bounded, observable, and unable to delete diagnostics for non-terminal or recently terminal submissions.
- Keep feedback local to each installation. Do not add a central OpenTriage collection service or cross-installation synchronization.

### AI Review CLI And Workflow Documentation

- Add a narrow internal CLI that uses the restricted reviewer database role rather than a user-facing HTTP listing endpoint.
- Support bounded, cursor-paginated listing filtered by status, type, priority, organization, and creation time.
- Support viewing one sanitized submission, its remaining diagnostic payload, and its review history by opaque reference code.
- Support a non-mutating proposal output that can contain a suggested summary, priority, duplicate relationship, status, and review note.
- Do not make invoking an AI model an unattended database job. A human explicitly starts each review session and decides whether to accept, reject, or modify proposals.
- Require explicit status, priority, and note arguments for a mutating review command. Require applicable duplicate or external links when that decision uses them.
- Require an additional confirmation flag for any bulk mutation. A proposal or dry run must never write review state.
- Record approved AI-assisted decisions with AI provenance and the approving human context supported by the invocation workflow. Human-authored corrections use the same append-only history.
- Do not allow the CLI to alter original submission content, restore deleted diagnostics, execute arbitrary SQL, or bypass supported status and validation rules.
- Document setup, reviewer-role requirements, safe listing, one-item review, proposal review, approved write, duplicate handling, external-link recording, diagnostic retention, and failure recovery for later AI sessions.
- State prominently that the human makes final decisions and that creating GitHub issues, branches, pull requests, or code changes requires a separate explicit instruction.

## Testing Decisions

Good tests verify externally observable behavior, privacy boundaries, durable
database invariants, and operator-visible workflow rather than internal class
structure, component boundaries, exact SQL formatting, or implementation-private
helper calls. All five confirmed modules require automated coverage.

### Feedback UI Tests

- Component tests cover control placement, accessible naming, tooltip behavior, explicit type selection, type-specific prompts, warning text, required and maximum-length validation, pending state, success announcement, failure retry, cancellation, and focus restoration.
- Test Mobile, Stationary, and Admin availability for authenticated server-backed sessions.
- Test omission from unauthenticated, forced-password, and static browser-only states.
- Test offline behavior and preservation of entered text across a failed online request without persisting it across reloads.
- Add keyboard-only and automated accessibility coverage for opening, operating, canceling, retrying, and successfully submitting the dialog.
- Add a Playwright journey that submits one bug and one feature request through the real UI/API boundary and verifies the user-visible reference confirmation.
- Follow the repository's existing interface-composition, browser-API, clinician-session, presentation-mode, dialog, and accessibility journey patterns.

### Diagnostics Tests

- Unit-test the versioned diagnostic schema and hard bounds for structural nodes, interactions, failures, strings, collections, and total encoded size.
- Verify a bug capture reflects the screen immediately before dialog opening and is discarded on cancel.
- Verify feature-request diagnostics omit structural, interaction, and failed-request detail.
- Seed representative values in every approved identifiable NEMSIS element and verify none appear in encoded diagnostics.
- Seed custom fields, narrative/free text, user and organization names, incident/location text, record identifiers, credentials, tokens, headers, cookies, request/response bodies, query values, arbitrary attributes, and input values and verify none appear.
- Verify permitted interaction names and normalized request failures remain useful while values, path IDs, and query data are absent.
- Verify buffers retain no more than 20 interactions and 10 request failures.
- Verify capture, serialization, and oversize failures produce a safe unavailable result without raw error details.
- Use adversarial fixtures that place sensitive strings in text nodes, attributes, ARIA metadata, datasets, URLs, and generated IDs rather than testing only expected form markup.

### Submission API Tests

- Test authentication, CSRF enforcement, server-derived user/organization attribution, and rejection of forged actor or review fields.
- Test valid Bug and Feature requests, diagnostic-unavailable success, unknown-field rejection, type-specific diagnostic validation, empty and overlong messages, and request/payload size limits.
- Test five accepted submissions in a rolling hour and the safe rejection of the next submission.
- Test idempotent retry returns the same reference without inserting duplicate submission, diagnostic, or review data.
- Test that the same idempotency key is independently scoped for different users.
- Test that ordinary sessions cannot list, view, update, or delete feedback through direct API access.
- Follow the repository's clinician-session, CSRF-guard, database-boundary, and replay-safe command tests.

### Database And Retention Tests

- Static database tests verify the private schema, tables, constraints, foreign keys, supporting indexes, revocations, and narrowly scoped role grants.
- Real-PostgreSQL integration tests verify atomic submission/diagnostic creation, uniqueness, immutable original content, valid state and priority constraints, duplicate-link rules, and append-only review history.
- Verify a review transaction appends one event and updates the current projection consistently, including under a stale or repeated review attempt.
- Verify application roles cannot select feedback tables directly and reviewer roles cannot rewrite original content or delete submissions.
- Verify queue filters and cursor ordering return stable results at page boundaries.
- Verify retention removes only diagnostics whose submissions have remained terminal for at least 30 days, preserves submissions and review events, skips open/recently terminal rows, and is idempotent.
- Verify reopening after diagnostics deletion does not reconstruct or imply recovery of the deleted payload.
- Extend the repository's database artifact, PostgreSQL integration, database-boundary, retention, and migration-runner precedents.

### Review CLI And Documentation Tests

- Test list filters, stable cursor pagination, sanitized detail output, missing references, and bounded output.
- Test that proposal and dry-run operations make no database changes.
- Test that a write requires explicit status, priority, and note inputs and rejects invalid transitions or missing duplicate relationships.
- Test the additional bulk-confirmation requirement and partial-failure behavior.
- Test recorded AI model/run provenance and human review context without recording prompts or hidden reasoning.
- Test that the CLI cannot alter original feedback, restore diagnostics, or accept arbitrary SQL.
- Verify command help and the documented examples use the actual supported interface.
- Follow the repository's dispatch CLI and database operations script testing patterns.

### Success And Failure Evaluation

- Success requires an authenticated user in each presentation mode to submit feedback without leaving the current workflow and receive exactly one reference for retries of the same draft.
- Success requires a reviewer to list the new item, inspect only sanitized context, present a non-mutating proposal, and record an explicitly approved decision through the documented CLI.
- Success requires terminal diagnostics to be removed after the retention interval without removing or changing the original submission or review history.
- Any leakage of excluded clinical, identity, authentication, request/response, or entered-value data is an automatic failure.
- Unauthorized feedback listing, mutation of original content, unattended AI mutation, duplicate creation during retry, or retention deletion outside the approved selector is an automatic failure.

## Out of Scope

- Feedback submission before sign-in, during forced password replacement, or from the static browser-only prototype.
- Offline feedback queuing, background synchronization, browser persistence, or service-worker storage.
- Screenshots, screen recording, raw DOM/HTML, console-log capture, full error stacks, keystrokes, input values, network headers, request bodies, response bodies, or raw endpoint URLs.
- Automatic free-text redaction, patient-identifier detection, content moderation, or a guarantee that users cannot type sensitive information despite the warning.
- A user-facing history, status tracker, edit/delete action, comments, voting, subscriptions, notifications, or maintainer replies.
- An Admin feedback inbox, dashboard, analytics UI, exports, or public roadmap.
- User-selected severity, priority, labels, assignee, due date, or implementation status.
- File, image, video, log, or arbitrary attachment uploads.
- A central hosted feedback collector, cross-installation aggregation, or automatic transmission to the OpenTriage maintainers.
- Unattended or scheduled AI triage, autonomous status changes, automatic model invocation, or storage of model reasoning and full prompts.
- Automatic GitHub issue creation, branch creation, pull requests, code changes, releases, or user notifications.
- Restoring diagnostics after retention deletion or retaining diagnostic archives outside the feedback schema.
- A generic arbitrary-SQL review utility or broad database credentials for an AI reviewer.

## Further Notes

- The approved identifiable-element list is necessary but not sufficient for UI
  privacy because identity and clinical text can appear outside tagged NEMSIS
  fields. The diagnostic contract therefore excludes all entered values and
  value-bearing visible text in addition to removing nodes covered by that
  policy.
- The user explicitly accepted a warning-only approach for feedback free text
  and directed that feedback be treated as non-sensitive application data. A
  user can still disregard the warning. Restricted access and minimizing the
  collected diagnostics remain prudent defenses, but they do not constitute
  automatic free-text de-identification.
- Separating optional diagnostics from the immutable submission is a technical
  inference made to support reliable deletion after terminal review. The exact
  table layout may vary if the same immutability and retention properties are
  demonstrated.
- PostgreSQL is the portable system of record. Supabase remains optional
  infrastructure; this feature does not depend on Supabase Auth, PostgREST,
  Storage, Realtime, or another hosted-only facility.
- The private schema and explicit grants follow the repository's established API
  ownership boundary. If a deployment exposes additional schemas through the
  Supabase Data API, `feedback` must remain outside that exposed set.
- Reviewer access is installation-local. Reviewing feedback from another
  deployment requires that deployment to grant explicit database access; this
  PRD creates no federation mechanism.
- The review CLI documentation is part of the deliverable because later AI
  sessions must be able to discover the intended safe workflow without inferring
  write permissions or commands.
- No unresolved product decisions remain from the feature interview. Exact
  component names, endpoint version notation, reference-code encoding, payload
  byte limit, and executable retention scheduling mechanism may follow existing
  repository conventions as long as they preserve the requirements above.

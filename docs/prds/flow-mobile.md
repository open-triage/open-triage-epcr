# Mobile Call Flow PRD

## Problem Statement

OpenTriage has a configurable clinical documentation interface and a revisioned clinical-report backend, but the mobile experience opens directly into one synthetic encounter. It does not represent the normal field workflow in which a clinician uses the phone associated operationally with an assigned unit, sees dispatched calls, opens a call exactly once, documents intermittently, and leaves an incomplete unsigned report available for later work.

For this first linked workflow, a demo clinician needs to sign in at the beginning of a shift, see synthetic calls assigned to the demo unit, open a call into the existing configurable documentation form, save without resolving every validation finding, and reopen their unsigned calls. Ambulance connectivity may be intermittent, the browser may be terminated, and the same report may later change on a stationary interface. The system must preserve work without silently duplicating drafts or overwriting concurrent edits.

## Solution

Provide a synthetic-only mobile call workflow around the existing configurable documentation interface. A prefilled demo login establishes the clinician for a fixed, administrator-configurable shift session. The server maps that demo clinician to a demo unit with a default form and supplies a deterministic assigned call. The mobile call list polls for assignments, separates **Assigned calls** from creator-owned **Open calls**, and creates one form-version-pinned draft idempotently when an assignment is opened.

The existing documentation interface remains unchanged. Edits persist immediately on the phone and synchronize to the revisioned backend after a short debounce. Opened calls remain usable when connectivity drops during an active protected session. A complete browser-process restart preserves only encrypted work and requires online recovery under the [Protected Offline Clinical Storage PRD](protected-offline-clinical-storage.md). **Save & close** returns to the call list even when validation errors remain. Concurrent disjoint edits merge; same-field edits use a guarded latest-client-edit policy with audit retention. Once a stationary workflow completes a report, it leaves the mobile list and can no longer be edited there.

## User Stories

1. As a demo clinician, I want the login fields prefilled with the demo account, so that I can exercise a recognizable login workflow without setup friction.
2. As a demo clinician, I want one sign-in to establish my identity for the shift, so that I am not asked to authenticate between calls.
3. As a demo clinician, I want the Android lock screen to remain the routine access boundary during my shift, so that the app does not repeatedly interrupt clinical work.
4. As an administrator, I want the maximum shift-session duration to be an organization-level setting, so that deployments can choose an appropriate duration.
5. As a demo operator, I want the demo organization to default to a 14-hour shift session, so that the demonstration reflects a typical long shift.
6. As a demo clinician, I want the app to log me out automatically when the configured session duration elapses, so that an expired shift does not remain active indefinitely.
7. As a demo clinician, I want to log out manually at any time, so that I can end access before the session expires.
8. As a demo clinician, I want unsynced work retained safely when I am logged out, so that logout does not destroy documentation.
9. As a demo clinician, I want locally retained work hidden until the same clinician signs in again, so that another user cannot open my cached drafts.
10. As a demo clinician, I want the server to associate me with the demo unit automatically, so that device enrollment is unnecessary in this workflow.
11. As a demo clinician, I want the demo unit to start with a synthetic assigned call, so that the workflow is immediately demonstrable.
12. As a demo clinician, I want assigned calls shown separately from calls I have already opened, so that I can distinguish new work from ongoing documentation.
13. As a demo clinician, I want the call-list sections labeled **Assigned calls** and **Open calls**, so that their meaning is operationally familiar.
14. As a demo clinician, I want an assigned-call card to show its call number, unit, dispatch time, dispatch reason or chief complaint, and assignment status, so that I can identify the correct call.
15. As a demo clinician, I want assignments refreshed immediately when the application launches or returns to the foreground, so that stale browser state does not delay a new call.
16. As a demo clinician, I want the visible call list to poll every 10 seconds when push delivery is unavailable, so that assignments appear promptly.
17. As a demo clinician, I want polling paused while the application is in the background, so that inactive browser use does not create unnecessary traffic.
18. As a demo clinician, I want a manual refresh action, so that I can request the latest assignment state immediately.
19. As a demo clinician, I want a canceled unopened assignment removed on refresh with a brief notice, so that obsolete calls do not remain actionable.
20. As a demo clinician, I want opening an assigned call to create exactly one draft report, so that retries cannot duplicate the patient-care record.
21. As a demo clinician, I want reopening or retrying the same assignment to return the same report, so that uncertain network outcomes remain safe.
22. As a demo clinician, I want an opened assignment moved into **Open calls**, so that its new state is clear.
23. As a demo operator, I want opening a synthetic assignment to generate a deterministic replacement assignment, so that the workflow can be repeated.
24. As a demo operator, I want generated calls to reuse one stable synthetic scenario template while receiving new identifiers, call numbers, and timestamps, so that demonstrations and tests remain deterministic.
25. As an administrator, I want the demo unit to have one default form, so that call opening does not require clinician form selection.
26. As a demo clinician, I want a newly opened report to pin the latest published version of the unit's default form, so that the record has a stable definition.
27. As a demo clinician, I want an existing open report to retain its pinned form after later publication, so that requirements do not change beneath active documentation.
28. As a demo clinician, I want an opened call to display the existing configurable documentation interface unchanged, so that this release tests workflow linkage rather than redesigning documentation.
29. As a demo clinician, I want each documentation edit saved immediately on the phone, so that a browser or network interruption does not lose my work.
30. As a demo clinician, I want local changes synchronized to the server after roughly one second of inactivity, so that rapid input does not require a request per keystroke.
31. As a demo clinician, I want to see whether the report is **Saved**, **Saving**, **Offline**, or in **Conflict**, so that persistence state is understandable.
32. As a demo clinician, I want to continue editing an already opened call without connectivity, so that field documentation does not depend on continuous service.
33. As a demo clinician, I want login and the first opening of an assigned call to require connectivity, so that identity, assignment, report identity, and form version are authoritative.
34. As a demo clinician, I want **Save & close** to return me to the call list even when the report has unresolved errors or warnings, so that mobile documentation can remain incomplete.
35. As a demo clinician, I want an offline **Save & close** to mark the open call as **Pending sync**, so that incomplete transmission is visible without trapping me in the form.
36. As a demo clinician, I want **Open calls** sorted by newest activity and labeled with call number, last-saved time, sync state, and current validation-error count, so that I can choose what to resume.
37. As a demo clinician, I want to reopen any of my unsigned reports in the existing form, so that I can add or correct documentation later.
38. As a demo clinician, I want only reports I created to appear in **Open calls**, so that authorship is unambiguous.
39. As a clinical-system operator, I want creator ownership enforced for report reads, writes, reopening, and queued synchronization on the server, so that client filtering cannot grant access.
40. As a demo clinician, I want a full browser termination and restart to preserve my unexpired session, cached form version, open reports, edits, ownership, and sync state, so that ordinary mobile-browser lifecycle events do not lose work.
41. As a demo clinician, I want browser restart to return to the call list rather than unexpectedly exposing an active clinical form, so that I deliberately choose the report to reopen.
42. As a demo clinician, I want cached work to remain scoped to my identity after restart, so that it is not exposed through another clinician session.
43. As a demo clinician, I want changes to different fields on mobile and stationary clients merged automatically, so that independent work is preserved.
44. As a demo clinician, I want the latest client edit to win when two clients change the same field from a shared base revision, so that the most recent intentional value is retained.
45. As a clinical reviewer, I want an overwritten conflicting value retained in append-only audit history with its author, device, client time, and server receipt time, so that automatic resolution remains traceable.
46. As a clinical-system operator, I want implausible future client times rejected and equal or untrustworthy times ordered by server receipt, so that a bad device clock cannot dominate conflict resolution indefinitely.
47. As a clinical-system operator, I want a stationary signature to remain immutable, so that late mobile synchronization cannot silently rewrite a completed record.
48. As a clinical reviewer, I want mobile changes received after signing appended as audit notes with their attempted changes and timing, so that late work is preserved for later evaluation.
49. As a demo clinician, I want an open report completed on the stationary interface removed from **Open calls** on refresh, so that mobile shows only actionable records.
50. As a demo clinician, I want a report completed while open on my phone to become non-editable and return me to the call list with a notice, so that I do not continue changing immutable work.
51. As a demo clinician, I want completed cached reports purged from the mobile store, so that obsolete local copies do not accumulate.
52. As a stationary user, I want signing, completion, case review, and completed-report history to remain stationary workflows, so that the first mobile release stays focused.
53. As a demo operator, I want every patient and call in this workflow to remain synthetic, so that the workflow can be exercised before production privacy controls are complete.
54. As a contributor, I want the critical workflow covered at Android-sized viewports, so that regressions in the target presentation are detected.
55. As a contributor, I want persistence tested across a complete Chromium process restart using the same browser profile, so that the test covers more than refresh or tab closure.

## Implementation Decisions

### Modules

1. **Shift identity and session policy** owns the prefilled demo login, clinician identity, organization-level session duration, automatic expiration, manual logout, and access to user-scoped local state. Its stable boundary exposes the current authenticated clinician and session deadline without coupling downstream modules to credential handling.
2. **Unit assignment and demo-call generation** owns demo user-to-unit resolution, the unit's default form, assignment lifecycle, foreground/list polling, cancellation, and deterministic synthetic replacement generation. It exposes assignment summaries without exposing report internals.
3. **Call opening and ownership** owns idempotent conversion of an assignment into a creator-owned draft, selection and pinning of the published form version, assignment-open state, and authorized Assigned/Open queries.
4. **Offline draft synchronization** owns immediate local persistence, debounced synchronization, queued mutations, sync-state reporting, browser-restart recovery, revision reconciliation, field-level conflict handling, and post-signature audit-note capture. It presents a report-oriented interface to the UI while adapting between the existing encounter document and backend mutation contracts.
5. **Mobile workflow shell** owns login presentation, call-list presentation, navigation into the existing documentation interface, Save & close, refresh behavior, and status notices. The existing configurable form stays encapsulated and unchanged.
6. **Completion reconciliation** owns detection of server-side completion, prevention of further mobile mutation, removal from Open calls, completion notices, and eligible local-cache cleanup.

### Data and domain model

- Add an organization-level session-duration setting with a seeded 14-hour value for the demo organization. No administrator settings UI is included.
- Represent the demo operational unit, its default form, the demo clinician's unit association, and call assignments as server-authoritative operational data rather than browser constants.
- An assignment has a stable identity and lifecycle sufficient to distinguish assigned, opened, and canceled states. Opening records the resulting stable report identity so retries return the same draft.
- The demo seed creates the demo clinician/unit/form association and one deterministic assigned call. Opening the current synthetic assignment creates the next assignment from the same scenario template with new UUIDv4 identities, call number, and timestamps.
- A draft remains owned by its documenting clinician. Unit association grants visibility to unopened assignments but never grants access to another clinician's open draft.
- Existing report form-version pinning remains authoritative. The assignment supplies the unit default form identity; draft creation resolves and pins the latest published version at open time.
- All new demo incidents, patients, assignments, and reports are explicitly synthetic.

### API contracts and interactions

- Authentication establishes the demo clinician and returns or makes available the fixed session deadline. The login UI uses prefilled demo credentials but still requires the user to submit.
- A clinician-facing call-list query returns authorized assigned-call summaries and creator-owned open-report summaries, including last activity, validation count, and sync-relevant status.
- The visible call list polls every 10 seconds, refreshes on launch and foreground entry, supports manual refresh, and stops polling while backgrounded.
- Opening an assignment is an idempotent server command. The same assignment and idempotency identity always resolve to the same report; success also advances the synthetic assignment generator.
- Creating a report requires connectivity. After creation, the client caches the report, pinned form definition, ownership, revision, queued changes, and relevant workflow state.
- Existing documentation state is adapted to the backend's stable group/occurrence identities and revisioned draft-change contract. The documentation components themselves are not redesigned.
- Local persistence occurs synchronously with user-visible edits. Server synchronization is debounced by approximately one second and uses stable command identities for safe retries.
- Save & close does not invoke signing and is never blocked by clinical validation findings. When online, it awaits the active save attempt; when offline, it leaves queued work marked Pending sync.
- Authorization checks the authenticated clinician for every unsigned report read, mutation, reopen, and queued command. Client-provided author identifiers do not independently confer access.
- Logout immediately clears the active UI/session and hides cached clinical state. Unsynced state remains stored under the originating user scope and can be resumed only by that same clinician.
- Browser restart navigates to a generic recovery state until online authentication loads server-authoritative report summaries. Protected report content is unlocked explicitly under the Protected Offline Clinical Storage PRD; an unexpired session alone is not a local-data confidentiality boundary.
- The synchronization protocol retains a base revision and per-change client edit time. Non-overlapping field or occurrence changes merge. Same-target changes use the latest trustworthy client edit time, then server receipt order as a deterministic tie-breaker.
- Conflict resolution is granular to a stable field or occurrence identity; it does not choose one entire report snapshot over another.
- Every automatically overwritten value remains represented in append-only audit data with author, device, client edit time, server receipt time, base revision, and winning value lineage.
- Client timestamps beyond an allowed future-skew bound are not eligible to win by client time. The exact bound is an implementation configuration, not a user-facing product setting in this release.
- If the report is already signed when queued mobile work arrives, no clinical occurrence is changed. The attempted mutation and timing are stored as append-only audit notes associated with the report.
- Completion reconciliation removes completed reports from mobile queries and locally cached actionable state. A client currently editing such a report stops accepting edits and returns to the list with a notice.
- Existing validation and documentation-interface behavior remain unchanged except that the workflow adds Save & close outside the signing/completion boundary.

### Deployment and configuration

- The session duration is server-side organization configuration with a 14-hour demo default. Direct deployment/database configuration is acceptable until a stationary administrator UI exists.
- The first release uses foreground polling and does not require push infrastructure.
- The browser cache remains an offline working copy, not the authoritative signed record.

## Testing Decisions

- Good tests verify externally observable behavior and durable contracts rather than internal component structure or private implementation details.
- All six modules will be tested.
- Shift identity tests cover prefilled login, fixed deadlines, automatic expiration, manual logout, user-scoped cached data, and same-user recovery.
- Assignment tests cover demo seeding, user-to-unit resolution, default-form selection, assigned/open/canceled transitions, idempotent opening, and deterministic replacement generation.
- Call ownership tests cover creator-only reads and writes, rejection of cross-user queued mutations, and immutable form-version pinning.
- Synchronization tests cover immediate local persistence, debounce behavior, retry idempotency, offline queueing, reconnect, disjoint merges, same-target latest-edit resolution, clock-skew fallback, audit lineage, and post-signature audit notes.
- Workflow-shell tests cover Assigned/Open presentation, 10-second polling, foreground refresh, polling pause in the background, manual refresh, Save & close with unresolved findings, Pending sync, reopening, and completion notices.
- Completion tests cover stationary signing/completion while a call is listed or actively open and local-cache cleanup.
- A Playwright end-to-end journey at the existing Android-sized viewport covers prefilled login, assignment discovery within 10 seconds, idempotent open, existing-form editing, offline continuation, Save & close with unresolved errors, Open-call reopening, reconnect synchronization, and removal after stationary completion.
- A dedicated Playwright persistence journey launches Chromium with a persistent profile directory, creates local and synchronized state, terminates the browser process, relaunches against the same profile, verifies that no clinical metadata is exposed while offline, then reconnects, authenticates as required, explicitly unlocks the report, and verifies recovery of its protected edits, ownership, and sync state.
- The persistent-profile test simulates a same-phone browser restart but is not presented as proof of Android OS process eviction or device-vendor behavior.
- Existing API draft-report tests provide prior art for idempotent commands, revision conflicts, and stable identities. Existing web persistence, review-flow, interface-composition, accessibility, and static-deployment tests provide prior art for local recovery and externally observable mobile behavior.
- Physical Android-device or emulator automation is deferred.

## Out of Scope

- Device enrollment, hardware identification, verification, reassignment, revocation, or QR pairing.
- CAD or dispatch-system integration.
- Web push, native push, background wake-up, or background assignment delivery.
- A stationary administrator UI for session duration, unit mapping, form mapping, or assignment creation.
- Changes to the existing configurable clinical documentation form, its field set, its patient-identifying presentation, or its validation behavior.
- Real patient data or a production-clinical claim; this workflow remains synthetic-only.
- Production identity providers, multifactor authentication, or deployment-specific enterprise authentication.
- Mobile signing, report completion, case review, completed-call history, or read-only signed-report access.
- Shared mobile editing, report ownership transfer, crew handoff, or contributor workflows.
- A conflict-review interface, audit-note review UI, or amendment UI.
- Fine-grained authorization rules for the content of post-signature audit notes beyond existing clinical authorization boundaries.
- Varied or nondeterministic synthetic clinical scenarios.
- Dynamic changes to an open report's pinned form version.
- Opening a previously unopened assignment while offline.
- Physical-device Android automation or proof of operating-system process-eviction behavior.

## Further Notes

- The current web application is a client-rendered single encounter shell backed by browser local storage. The current API and PostgreSQL schema already support idempotent draft creation, revisioned draft changes, client/device timing metadata, signed immutability, published form-version pinning, and an unsigned operational work queue. The feature should reuse those contracts while adding the missing identity, operational assignment, workflow, and synchronization linkage.
- The current Playwright projects use desktop Chromium at 360-by-800 and 390-by-844 viewports with touch enabled. Persistent-profile restart coverage will materially improve lifecycle testing, but physical Android testing remains a separate confidence layer.
- Client wall clocks are not fully trustworthy. Latest-client-edit conflict handling therefore depends on a bounded-skew policy, deterministic server-time fallback, and append-only audit preservation.
- Local clinical data follows the encryption, key-release, retention, and lifecycle requirements in the Protected Offline Clinical Storage PRD. Device-bound protection and mobile-device management remain deferred to device-vehicle linking and are not implied by user-bound encrypted recovery.

# Report Media Notes PRD

# Problem Statement

OpenTriage's mobile workflow can capture a text note only by writing it into the
NEMSIS patient-care narrative. It cannot capture photos or spoken notes, and
Stationary mode does not expose the encounter timeline beside the form.
Clinicians therefore lack a fast, consistent way to retain observations that
belong to the patient-care record but are not NEMSIS fields.

Field documentation must survive intermittent connectivity and browser
interruptions. Media also contains sensitive clinical information that must
never be placed in plaintext browser storage or exposed through public URLs.
Once a report is signed, its notes must be immutable, integrity-bound to the
report, retained and archived with it, and deleted with it. Synthetic demo
records must continue to expire completely after 24 hours.

The agency-owned media quota also exposes a broader gap: installation
administrators do not have one focused place for safe operational settings. A
codebase review is needed to identify other hardcoded values that are genuinely
agency-owned without making security, retention, clinical-protocol, or schema
invariants casually configurable.

# Solution

Add app-native text, photo, and spoken-audio notes linked to a draft report but
stored outside its NEMSIS document. Mobile mode presents six fixed quick actions
in two rows: structured NEMSIS documentation first and the three note types
second. Each note is an independent timeline entry with immutable capture time,
author, and audit provenance. Text is required for a text note; media captions
are optional. Media is captured live, staged in encrypted IndexedDB when
necessary, synchronized independently, and stored as private binary data in
Postgres.

Reuse the complete mobile timeline in a collapsible Stationary right sidebar.
Every note can be opened, and audio can be played directly from its row.
Authorized clinicians may revise text and captions or delete notes while the
report is a draft. Media bytes cannot be replaced after save. Note readiness is
separate from NEMSIS validation but blocks signing until every asset is
uploaded, normalized, verified, and openable.

Add an Agency Settings panel for installation-level operational preferences.
The first setting is the aggregate media allowance, defaulting to 50 MB per
report. A repository-wide hardcoded-value review identifies other clearly
agency-owned, low-risk candidates and produces a prioritized inventory for
everything deferred.

# User Stories

1. As a mobile clinician, I want Vitals, Medication, and Procedure on the first quick-action row, so that structured documentation remains familiar.
2. As a mobile clinician, I want Text note, Photo note, and Audio note on the second row, so that unstructured observations are fast to capture.
3. As a clinician, I want all three note actions independent of the configured NEMSIS form, so that form fields do not determine note availability.
4. As a clinician, I want text notes stored outside the patient-care narrative, so that a quick note does not alter `eNarrative.01`.
5. As a clinician, I want the ordinary NEMSIS narrative independently editable, so that formal narrative documentation remains unaffected.
6. As a clinician, I want each note to contain exactly one text entry, photo, or recording, so that its time, state, and audit history are unambiguous.
7. As a clinician, I want a text note to require non-whitespace content, so that empty timeline entries cannot be saved.
8. As a clinician, I want up to 10,000 characters in a text note, so that substantial observations can be retained.
9. As a clinician, I want an optional caption of up to 500 characters on media, so that I can explain its relevance.
10. As a clinician, I want counters and safe input normalization, so that limits are clear and control characters are rejected.
11. As a clinician, I want photo capture to use the live camera rather than my media library, so that provenance is clear.
12. As a clinician, I want photo capture to prefer the rear camera, so that scene and document photography is convenient.
13. As a clinician, I want to cycle through available cameras, so that I can select the appropriate lens.
14. As a clinician, I want to rotate a preview clockwise or counterclockwise in 90-degree steps, so that its saved orientation is correct.
15. As a privacy-conscious clinician, I want EXIF, GPS, and device metadata removed, so that photos do not disclose unrelated information.
16. As a clinician, I want photos normalized at high quality to at most 2560 pixels on the longest edge, so that detail and storage remain balanced.
17. As a clinician, I want the chosen rotation applied before save, so that immutable stored bytes match the preview.
18. As a clinician, I want audio notes limited to spoken observations, so that the feature is not mistaken for diagnostic-sound capture.
19. As a clinician, I want simple start/stop audio capture, so that recording remains quick and unambiguous.
20. As a clinician, I want elapsed time, input-level feedback, and a remaining-time warning, so that I know capture is working.
21. As a clinician, I want audio to stop after five minutes, so that recordings and offline storage remain bounded.
22. As a clinician, I want an interrupted valid recording offered for Use or Discard, so that an interruption does not silently lose usable speech.
23. As a clinician, I want to preview media before saving, so that I can retake or discard an unsuitable capture.
24. As a clinician, I want a completed preview recoverable after an accidental refresh when storage remains available, so that a browser interruption does not waste it.
25. As a clinician, I want audio normalized for consistent playback, so that another authorized workstation can open it.
26. As a clinician, I want no automatic transcription, so that unreviewed machine text is not introduced into the record.
27. As a clinician, I want a new note to appear on the timeline immediately, so that I receive confirmation while offline.
28. As a clinician, I want states labeled Saved on this device, Uploading, Processing, Ready, or Failed, so that persistence is understandable.
29. As a clinician, I want failed notes to offer retry or deletion, so that I can resolve them without losing control of the report.
30. As a clinician, I want pending notes openable from encrypted local copies, so that I can review them without connectivity.
31. As a clinician, I want synchronized draft media cached for offline reopening, so that losing connectivity does not remove recent information.
32. As a privacy owner, I want pending media protected from eviction and all staged media encrypted, so that reliability never requires plaintext storage.
33. As a clinician using best-effort browser storage, I want an eviction warning and prioritized upload, so that I understand the durability limit.
34. As a clinician, I want Save & close available while media is pending, so that synchronization does not trap me in a report.
35. As a clinician, I want a warning when closing may pause uploads, so that browser transfer limitations are explicit.
36. As a clinician, I want transfers to resume while the app is open or on the next authenticated session, so that intermittent connectivity does not require recapture.
37. As a clinician, I want structured events and notes together in one newest-first timeline, so that I have one chronology.
38. As a clinician, I want text excerpts, photo thumbnails, and audio duration/status in compact rows, so that notes are easy to identify.
39. As a clinician, I want to play or pause audio directly from its row, so that quick review does not require a dialog.
40. As a clinician, I want activating a note row to open its complete viewer or editor, so that content and metadata are accessible.
41. As a Stationary clinician, I want a header button to toggle a docked right timeline sidebar, so that notes remain accessible beside the form.
42. As a Stationary clinician, I want the sidebar to reuse the mobile timeline, so that event behavior stays consistent.
43. As a Stationary clinician, I want All and Notes filters, so that I can see complete chronology or focus on notes.
44. As a Stationary clinician, I want my sidebar choice remembered and initially closed, so that form width follows my preference.
45. As an authorized clinician, I want to edit note text and captions while draft, so that mistakes can be corrected.
46. As an authorized Stationary clinician, I want the same draft edit and delete permissions as Mobile, so that correction does not require a mode switch.
47. As a clinical reviewer, I want saved media bytes immutable, so that a capture cannot be silently replaced.
48. As a clinician, I want correction of saved media to require deletion and recapture, so that provenance remains clear.
49. As a clinician, I want confirmation before deleting a saved note, so that an accidental action does not remove information.
50. As an auditor, I want note creation, edits, and deletion attributed to an actor and time, so that draft changes are traceable.
51. As an auditor, I want sensitive media retrieval audited without copying content into the event, so that access is traceable without multiplying PHI.
52. As a privacy owner, I want no explicit download action and no-store responses, so that casual device copies are discouraged.
53. As a clinician, I want note permissions to match the report's authorization, so that notes do not create another access model.
54. As a clinician, I want capture time immutable and displayed in the agency timezone, so that chronology remains coherent.
55. As an auditor, I want UTC instant, device offset, author, and server receipt time retained, so that clock discrepancies are diagnosable.
56. As a clinician, I want note edits to use normal report revision and conflict handling, so that concurrent work is reconciled consistently.
57. As a clinician, I want signing blocked by unavailable media, so that a signed report never references inaccessible content.
58. As a clinician, I want note-readiness blockers separate from NEMSIS validation and linked to the affected note, so that I can resolve the right problem.
59. As a reviewer, I want the signed report to cryptographically bind notes and media hashes, so that tampering is detectable.
60. As a reviewer, I want signed notes read-only, so that the completed record remains immutable.
61. As a records administrator, I want notes archived and retained with their report, so that independence from NEMSIS does not remove them from the legal record.
62. As a records administrator, I want metadata, bytes, caches, and processing data deleted with the report, so that purge is complete.
63. As a demo operator, I want synthetic notes deleted when their report expires after 24 hours, so that demo media cannot outlive it.
64. As an agency administrator, I want the aggregate media allowance configurable, so that storage policy matches agency needs.
65. As an agency administrator, I want a 50 MB default allowance, so that deployments begin conservatively.
66. As a clinician, I want a photo bounded only by the report's remaining allowance after normalization, so that another limit does not reject it.
67. As a clinician, I want offline captures valid under an earlier settings revision grandfathered after a reduction, so that policy changes cannot strand work.
68. As an agency administrator, I want a focused Agency Settings panel, so that operational preferences are discoverable.
69. As an agency administrator, I want setting changes applied immediately with stale-write protection, so that administration is simple and safe.
70. As an auditor, I want setting changes recorded with actor, time, and safe old/new values, so that configuration is accountable.
71. As a product owner, I want the codebase reviewed for hardcoded agency-owned values, so that settings grow from evidence.
72. As a security and clinical owner, I want risky candidates inventoried instead of automatically exposed, so that safeguards receive deliberate review.
73. As a mobile clinician, I want capture supported on current and previous major iOS Safari and Android Chrome, so that common field devices work.
74. As a Stationary clinician, I want viewing on current Chrome, Edge, Safari, and Firefox, so that common workstations work.
75. As a clinician on an unsupported browser, I want precise guidance while text notes remain available, so that missing media support is clear.

# Implementation Decisions

## Modules

1. **Report Notes Domain** owns app-native note identity, metadata, draft mutation, authorization, revision participation, audit attribution, readiness, signed-manifest projection, retention, and deletion. It exposes notes without representing them as NEMSIS elements.
2. **Media Persistence and Processing** owns private Postgres binary persistence, authenticated transfer, validation, normalization, integrity hashes, state transitions, quota reservation, cleanup, and verified readiness. Its persistence interface permits a later move to object storage.
3. **Offline Media Queue** owns encrypted IndexedDB staging, recoverable previews, cache state, retry, best-effort background transfer, settings-revision capture, eviction, session scoping, and cleanup.
4. **Shared Timeline Experience** owns the reusable timeline, note rows, mobile capture flows, viewer/editor dialogs, direct audio playback, Stationary sidebar, focus restoration, and accessible status messaging.
5. **Agency Settings** owns installation-level operational settings, authorization, optimistic revisions, immediate activation, safe audit history, and the hardcoded-value inventory.
6. **Report Lifecycle Integration** owns final readiness validation, atomic signing and freezing, manifest binding, archive projection, retention, synthetic expiry, purge ordering, and non-revivable cleanup.

## Domain and schema

- Introduce app-native note metadata keyed by organization, report, and note identity. A note records type, immutable capture instant, original offset, author, normalized text or caption, lifecycle state, settings revision, and attribution.
- Store at most one media asset per media note. Persist canonical bytes in a separate private Postgres table using `bytea`, with MIME type, size, SHA-256 digest, processing state, and ownership keys.
- Keep binary columns out of ordinary report and timeline queries. Media retrieval uses a dedicated endpoint and never base64-embeds bytes in report JSON.
- Store transient upload/conversion state separately from the canonical ready asset and reclaim abandoned work without deleting valid canonical media.
- Normalize text to Unicode NFC, trim appropriately, reject disallowed control characters, and enforce the agreed limits server-side.
- A media note consumes quota according to canonical bytes. Upload initiation reserves capacity so concurrent transfers cannot independently pass the same remaining-quota check.
- The aggregate allowance defaults to 50 MB. A photo has no separate byte ceiling and may consume any remaining allowance after normalization.
- Record the settings revision and effective allowance at capture. A valid pending capture remains admissible after reduction; new captures use the latest settings and server revalidation.
- Store capture instants as UTC with device offset and server receipt time. Presentation uses the agency timezone.
- Do not migrate existing `eNarrative.01` values or retain a compatibility path; there are no production users.

## Capture and processing

- Photo and audio actions permit live in-app capture only; device-library selection is excluded.
- Request the environment-facing camera first and provide cycling through enumerated cameras with clear degradation where unavailable.
- Allow 90-degree clockwise/counterclockwise preview rotation. Apply orientation, constrain the longest edge to 2560 pixels, retain high quality, remove metadata, and encode a validated canonical image.
- Saved canonical bytes and digests are immutable. Text and captions remain draft mutations.
- Audio is voice-note capture with start/stop, elapsed time, input-level feedback, a limit warning, and automatic stop at five minutes. It never continues in the background.
- On interruption, retain and preview valid chunks where supported and label the result. Never silently save it.
- Accept a narrow allowlist of decodable sources. Normalize audio to mono AAC/M4A at approximately 64 kbps and keep the source only through verified conversion.
- Mark media Ready only after canonical storage, hash verification, decoding, and authorized retrieval succeed. Audio must finish normalization.
- Automatic transcription and diagnostic-audio claims are prohibited.

## API and authorization

- Add report-scoped contracts to list note metadata, create text notes, initiate/finalize media notes, edit text/captions, delete drafts, retry failures, and retrieve canonical media.
- Reuse ordinary report authorization and signed-state enforcement. Client-supplied ownership, type, size, and readiness claims are not independently trusted.
- Metadata mutations use stable command identities, expected report revisions, and existing reconciliation. Transfer and processing progress do not advance clinical revisions.
- Media is returned only after current authorization and ownership checks, with a strict type allowlist, safe inline disposition, and `Cache-Control: no-store`.
- Note mutation audit events remain bounded and omit text, captions, and media. Photo opening and audio retrieval produce distinct content-free access events.
- Deletion remains idempotent, revision-guarded, and able to cancel/clean in-progress media state.

## Offline synchronization

- Stage photos and emitted audio chunks in encrypted IndexedDB as early as practical. Plaintext browser-storage fallbacks are forbidden.
- Encrypted best-effort IndexedDB is acceptable without durable-storage guarantees. Surface eviction risk and prioritize synchronization.
- Retain pending media until verified server receipt. Retain encrypted active-draft caches for offline reopening; storage pressure may evict only server-confirmed copies.
- Purge local media and key access when a report is signed, deleted, expired, unauthorized, or removed under protected-storage rules.
- Use one state model for timeline, viewer, close warnings, and signing review.
- Save & close may leave queued media. Transfer continues while the app runs, uses browser background sync only as an optimization, and resumes on a later authenticated session.
- Logout and restart follow the existing protected offline clinical-storage boundary; encryption is never weakened for convenience.

## Timeline and presentation

- Mobile quick actions are two fixed three-column rows in the agreed order. Note actions are not hidden or renamed by NEMSIS form profiles.
- Rework the current note editor to use the app-native domain. Remove NEMSIS references, requiredness, findings, and form-profile quick-action configuration for notes.
- Compose one reusable newest-first timeline from NEMSIS-derived events and app-native notes, with stable tie ordering.
- Note rows expose type, time, author, readiness, and excerpt, thumbnail, or duration. Rows open a modal; audio also has independent accessible play/pause.
- Only one audio note plays at a time. Leaving the report or losing authorization stops playback.
- Add a Stationary header toggle and docked sidebar approximately 360 pixels wide. Remember state locally; default closed.
- Reuse the full Mobile timeline in Stationary with compact All and Notes filtering. Do not add Stationary capture creation.
- Draft viewers expose permitted edit/delete actions. Signed rendering will be read-only in a future report viewer.
- Provide meaningful non-content alternatives using note type, time, author, and caption where present.

## Signing, retention, and integrity

- Treat non-Ready media as a non-NEMSIS signing blocker and link review items to retry/delete actions.
- The signing transaction locks report and notes, rechecks authorization, revision, readiness, quota, and integrity, and freezes them atomically.
- Extend the signed manifest with note identity, type, capture time, author, normalized text/caption, media digest, size, and MIME type.
- Archive metadata and media with the report; emit none of it into NEMSIS XML.
- Ordinary notes use report retention. Synthetic note data and artifacts expire with the report after 24 hours.
- Purge removes dependent media, leaves only bounded non-clinical evidence, and prevents offline resurrection.

## Agency Settings

- Add an Agency Settings panel to the authorized Admin workspace, separate from catalog/form/validation configuration.
- Use explicit Save, optimistic revisions, immediate activation, bounded validation, and immutable safe old/new audit entries.
- Restrict operations through the existing administrative capability model; UI visibility is not authorization.
- Add aggregate report media allowance with a 50 MB default. Values above the default show a Postgres storage/backup warning. The allowed range remains an engineering validation decision because the conversation set no maximum.
- Reductions do not invalidate canonical media. New captures use the new value, while qualifying offline captures are grandfathered.
- Review application, API, database, deployment, and seed configuration for hardcoded agency-owned values. Record each candidate, owner, rationale, safety class, dependencies, and recommendation.
- Migrate only clearly agency-owned, low-risk candidates. Inventory security, legal-retention, protocol, interoperability, and schema-sensitive candidates for deliberate follow-up.

## Postgres media operations

- Keep media tables private and available only through narrowly granted application operations; do not expose them through a public Data API.
- Index ownership, lifecycle state, cleanup eligibility, and synchronization lookup paths; never index binary content.
- Fetch media by exact organization/report/note identity and exclude binary columns from list, signing-check, archive-enumeration, and audit queries.
- Bound API media handling so no request loads an entire report allowance into process memory.
- Include binary data in database, WAL, replica, backup, restore, vacuum, and purge capacity planning. Monitor canonical/temporary bytes, failures, orphans, and cleanup outcomes.
- Preserve a stable repository interface so future object storage does not rewrite notes, timelines, manifests, or archives.

# Testing Decisions

- Good tests verify externally observable behavior and safety invariants rather than private component structure, SQL formatting, codec-library calls, or hook details.
- Test all six confirmed modules: Report Notes Domain, Media Persistence and Processing, Offline Media Queue, Shared Timeline Experience, Agency Settings, and Report Lifecycle Integration.
- Extend existing note-flow and encounter tests to prove text notes no longer mutate `eNarrative.01`, are absent from NEMSIS validation, and combine with canonical events.
- Add domain tests for normalization, validation, immutable time, one-asset ownership, revisions, deletion, ordering, state transitions, and settings grandfathering.
- Add API/database integration tests for organization isolation, authorization, signed-state denial, exact ownership lookup, concurrent quota reservation, digest verification, idempotency, bounded audit, and absence of blobs from ordinary queries.
- Add processing tests with small fixtures for orientation, resizing, metadata removal, allowed/invalid audio, duration enforcement, AAC/M4A output, failed conversion, source cleanup, and readiness.
- Follow protected-storage prior art for encrypted staging, no plaintext, refresh recovery, eviction warnings, pending non-eviction, confirmed eviction, session scoping, retry, Save & close, and cleanup.
- Add accessibility tests for action layout, capability guidance, camera cycling, rotation, recording status, note rows, audio controls, dialogs, deletion, sidebar, filtering, focus, keyboard, and live announcements.
- Add mobile end-to-end journeys for online/offline capture, interruption recovery, resume, quota exhaustion, retry, Save & close, and reopening.
- Add Stationary journeys for sidebar persistence, timeline reuse, filtering, audio playback, viewer opening, draft edit/delete, and readiness navigation.
- Extend synchronization tests with multi-client creation, disjoint/conflicting edits, deletion during upload, signing races, stale settings, and server completion with pending media.
- Extend signing tests to prove pending media blocks, Ready media is manifest-bound, post-sign mutations fail, and processing progress does not create clinical revisions.
- Extend retention/purge tests to prove bytes, sources, metadata, recovery data, and delayed work follow the report lifecycle and cannot resurrect it.
- Add Agency Settings tests for authorization, activation, stale-write rejection, audit values, warnings, reductions, and inventory completeness.
- Exercise capture on current and previous major iOS Safari and Android Chrome; exercise viewing on current Chrome, Edge, Safari, and Firefox. Maintain a manual matrix where automation is unavailable.
- Add performance checks proving ordinary queries avoid binary columns, exact retrieval uses intended indexes, quota enforcement is atomic, and maximum test payloads respect API memory bounds.

# Out of Scope

- Migrating historical quick-action text from `eNarrative.01`.
- Copying app-native notes into NEMSIS fields or XML.
- Automatic transcription, summarization, or structured-field extraction.
- Diagnostic sound recording or interpretation.
- Selecting existing files from device libraries.
- Multiple media files grouped into one note.
- Replacing saved media bytes in place.
- Explicit download controls or a general record-export workflow.
- A completed-report search/viewer; future viewing will render retained notes read-only.
- Creating notes from Stationary mode.
- Mobile action customization beyond this fixed layout.
- Guaranteed uploads after full browser/OS termination.
- External object storage in this delivery.
- Making every hardcoded candidate configurable now.
- Weakening security floors or casually configuring retention, protocol, or interoperability invariants.

# Further Notes

- The current application derives text-note timeline events from an app-owned narrative group and writes successive quick notes into one NEMSIS value. This PRD replaces that behavior.
- Existing revisioned synchronization, encrypted browser storage, Mobile timeline, Stationary signing gates, synthetic expiry, and archive/purge mechanisms should be extended rather than duplicated.
- Postgres media is a conscious first-version choice under a conservative default quota. It simplifies authorization, atomic signing, expiry, and deletion but increases database, WAL, replica, backup, and restore volume.
- The exact allowed agency quota range is an engineering validation decision bounded by proven database, API, backup, and client behavior. The product decision fixes the default at 50 MB, not an unlimited maximum.
- Image size is bounded by normalization and remaining report allowance only; there is no separate per-photo byte setting.
- Signed-report viewing is deferred, but persistence must allow a future viewer to render notes without migration.
- Hardcoded-value audit findings are candidates, not automatically approved requirements. Each must be classified before migration.
- This PRD records product intent and delivery boundaries; it does not itself authorize implementation.

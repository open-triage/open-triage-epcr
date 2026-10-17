# Audit logging and administration

The Admin **Audit logs** tab displays bounded, agency-scoped event metadata.
Apply `20261017212157_audit_logs.sql` before deploying the corresponding API.
This consolidated migration establishes the final audit tables, UUIDs, payload
inspection and filters. Existing protected Administrator and Demo roles receive
both `audit:read` and `audit:identifying` through one new immutable role version.
Historical versions, assignments and custom roles are preserved. Custom roles
require explicit grants through the ordinary role editor. New agencies receive
the capabilities through the protected-role registry.

## Permissions and sections

The endpoint is `GET /api/admin/audit`. It resolves a live session and requires
`audit:read` on every request. The organization comes from that session; it is
not a request parameter. Parent-agency membership does not aggregate child logs.
Switch to the relevant agency using the existing agency workflow.

Patient-related sections additionally require `audit:identifying` and reject
installation owner/super-admin sessions even if those sessions carry broad
capabilities. Audit inspection history is also protected because its target
filter may identify a patient. A role with only `audit:read` can use the other
sections without gaining clinical-record access. `audit:identifying` has a
database-enforced `audit:read` prerequisite. `review:identifying` alone does not
grant identifying audit access. Custom roles receive neither new permission
automatically.

In **Clinical changes**, identifying auditors can explicitly load retained
clinical values for a particular event. Signing/amendment events expose their
recorded prior/new values, draft saves expose submitted changes, conflict
resolution exposes the discarded conflicting change, and post-signature attempts
expose the attempted change. These are historical event values; the dialog does
not infer an earlier value from the current record. Event sources without retained
clinical values only display metadata. The value endpoint checks the live session,
agency and identifying audit permission again, records the inspection and a
patient-access event, and fails before returning values if either write fails.
Values are not included in list responses, browser storage, authentication logs or
configuration logs.

| Section | Sources |
| --- | --- |
| Patient access | `clinical_audit.patient_access_event` |
| Authentication | Sign-in/session/account events; agency-associated operator account events |
| Permissions | Authorization, ownership-transfer and organization events |
| Configuration | Form/configuration activation, catalog publication, validation changes, agency settings and demographic changes |
| Clinical changes | Signing/amendment events, draft saves, conflict resolution, note mutations and post-signature attempts |
| Media access | Existing photo/audio access events |
| Recovery | Offline lifecycle, key lifecycle and report recovery metadata |
| Review workflow | Assignment, overdue, progress, saved-analysis, routing and policy history |
| Synthetic data | Generation and draft mutation events |
| Installations and units | Installation events and operational-unit changes |
| Feedback | Accepted bug/feature submissions and review status history, excluding descriptions, diagnostics, summaries and review notes |
| Audit inspections | Each successful audit-browser query, including empty results, and clinical-value inspections |
| Analytics and exports | Unified analytics queries, catalog discovery/counts and CSV exports; legacy Review analysis, volume and workload queries/exports |

Installation and unit events show `succeeded`: they are recorded in the same
transaction as the completed change. This includes enrollment issuance, enrollment,
reassignment, revocation, and unit creation/updates. The outcome describes the event
at that time, independently of the current unit or installation state. Rejected
attempts are not written to these two event sources.

All sources explicitly define their outcome projection. Stored authentication,
configuration, media, key/recovery and feedback results are preserved. Permission,
agency/profile, validation, saved-analysis, policy and synthetic-data histories
show `succeeded` for their completed operations. Clinical signing and amendments
also show `succeeded`; draft commands show `accepted` because individual edits may
lose conflict reconciliation. Conflict records show `reconciled`, and queued edits
retained after signing show `not-applied`.

Offline recovery lifecycle events distinguish `recorded`, `succeeded`, `unavailable`,
`expired` and `applied`. Review assignment changes show `assigned` or `unassigned`
from the historical assignee. Overdue history distinguishes `opened`, `resolved`,
`closed` and `reconciled`; automatic removal of an ineligible review route shows
`unassigned`. These outcomes use event evidence rather than the target's current
state. Unrecognized actions in the open-ended clinical ledger remain unspecified
instead of being assumed successful.

Sources without an agency association, infrastructure stdout, PostgreSQL server
logs and `operations.query_audit_event` are outside this agency browser. They
remain operational sources with their existing access procedures. This tab is
not a generic database viewer. The explicit list projection in
[`AuditService`](../../apps/api/src/admin/audit.service.ts) excludes clinical
values, free-text notes, request payloads, credential/session tokens, recovery
handles and cryptographic key material. Actors are displayed using their current
display name, falling back to a local or linked SSO username, then the recorded
ID if the account is unavailable. Names are resolved only for actors
in the authorized page; immutable actor IDs remain in the evidence and API filters.
Targets show their record type and available display name, PCR number, call number,
unit call sign, configuration name/version or feedback reference. Lookups are bounded
to the authorized page and agency (catalog releases are shared metadata). Names reflect
the current record; immutable events and target IDs are unchanged. Missing records use
the type and a short reference, with full event, user, target, patient, agency and resource
IDs available in the dialog's collapsed **Identifiers** section. Patient
names and other clinical values are not used as target labels. Event codes are shown
as recorded; UI labels are localized in English and Swedish.

Queried and accessing agencies show their current names. Agency lookups use only IDs
referenced by the authorized page, including historical cross-agency analytics scope.
Analytics references show their type and operation without repeating the timestamp.
Photo, audio and text-note references show their type and timestamp. Patient context uses the associated PCR number;
it does not load a patient's clinical identity. Missing records retain a typed short
reference. Names are display metadata, not replacements for the immutable recorded IDs.

## Browsing

All permitted log types share one chronological table. Expand **Log types** to
select one or more types, then apply the filters. A blank selection means all
permitted logs; **Clear log types** restores that selection. The checkboxes wrap
to fit the available width. Choose a UTC date interval of at most 31 days. Optionally filter
by a user selected by display name or **Any UUID**. The UUID filter matches a complete
UUID exactly (case-insensitively) against the event ID, actor, target, patient,
related resource, record agency, accessing agency, analytics agencies and recorded
inspection filters. It searches metadata within the selected dates, types and
authorized agency; it does not search JSON payloads or partial IDs. The user dropdown
includes active and disabled agency members and loads further names in pages of
100. `GET /api/admin/audit/users` requires `audit:read`, returns only account IDs
and display names from the current agency, and does not require `users:read`.
The selected account's immutable ID is sent as an additional filter. An analytics
event UUID also finds linked patient-access events and subsequent audit inspections.
Feedback submissions appear immediately after acceptance with their original submission
time and reference code, including submissions made before this browser was introduced.
Retries of the same submission produce one entry. Later review decisions appear as
separate events and do not change the submission's original accepted outcome.
Pages contain at most 50 events, ordered by time, source and event ID. Pagination
shows **Page X of Y** plus the visible and total event counts for the applied
filters. Empty results show page 0 of 0. Counts and rows use the same agency,
permission, type, user and UUID filters. Each traversal retains its first page’s
upper event-time bound so newly recorded inspections do not increase the page
total; applying filters or returning to the first page includes newer events.
The counts are recomputed for each response, so deletion or late-arriving events
with earlier timestamps can still change them. The cursor
preserves microsecond timestamps. The table starts with an **Event ID**
column containing a permanent UUID without a source prefix, followed by a
localized **Log type** column. Sources with UUID
primary keys keep their existing IDs. Numeric sources receive an immutable,
unique `audit_id` generated by PostgreSQL for both retained and future events;
their internal primary keys and foreign keys remain unchanged. The source remains
available in the details dialog. UUIDs identify events; timestamps determine order.
Audit inspections show the inspected event's ID as their target for
JSON and new clinical-value inspections. List inspections identify the queried
types; combined inspections show the number of types and list their names in the dialog; older clinical-value inspections retain their recorded report target,
because their exact event reference was not captured.
JSON and clinical-value inspection endpoints accept UUIDs, and feedback JSON dumps
use the same public UUIDs as the list. The migration rewrites existing numeric
source tables to populate UUIDs and holds table locks for that transaction; deploy
it before the updated API during a maintenance window for large installations.
Click a row, or focus it and press Enter or Space,
to open its source, patient ID and accessing agency/process in a modal dialog.
Close the dialog with Escape or Close details to return to the same row.
For analytics and feedback events, **Show JSON dump** expands the full retained
payload. `GET /api/admin/audit/payload/:source/:id` rechecks `audit:read`, the source
and the event's agency. Analytics additionally requires `audit:identifying` and
rejects installation owner/super-admin sessions. It records the inspected source
and event ID before returning any content; failed inspection logging returns no
payload. The JSON stays in the open dialog's memory and is discarded on collapse,
close, or revoked access. A new expansion performs a fresh authorized inspection.

Feedback dumps include the original description, submission attribution and retained
diagnostics. A review event additionally includes that review's approved summary,
note and attribution. Missing or expired diagnostics are marked `not-retained`;
the original report remains available. Analytics dumps include the validated search,
definition, filters, grouping, date range, selection or export parameters and
execution scope, including agency names alongside their IDs. Feedback reviews also
include the reviewer's current display name when available. The captured request itself
is unchanged. Earlier analytics events have no captured request; the dialog
explains this and shows the summary that was recorded. No old request is inferred
from today's configuration or saved visualizations.
The Audit logs tab has no log
download/export endpoint.

A pending or unsuccessful request retains the previous table with its original
log-type and date-range label. Revoked or expired access clears the loaded results.
Data stays in component memory and is not stored in browser local storage.
Responses carry `no-store, private`. One server query combines the selected types
before sorting and cursor pagination; changing filters starts on the first page.
The API accepts comma-separated `categories`; omitted or blank means all permitted
types. The legacy single `category` parameter is still accepted, but cannot be
combined with `categories`. Explicitly requesting a forbidden type rejects the
whole query. Opening a page records one inspection with reviewer, agency, actual
queried types, time bounds, optional filters and returned count before returning
results. General UUID searches use the `uuid` API parameter and are recorded in
`uuid_filter`, visible as **Searched UUID** in inspection details. The legacy
`targetId` parameter retains its target/patient/resource-only behavior and cannot
be combined with `uuid`; historical `target_filter` evidence is unchanged.
Historical single-type inspection evidence is preserved.
This records inspection, not the completion or conclusions of a formal review.

## Patient-access event semantics

The new channel records authorized server reads of:

- Raw drafts, reopened records and active-report polling, including a matching
  ETag/304 that authorizes reuse of the browser's existing record.
- Open-report lists, with one event for each returned report identity.
- Opening an assigned call's report.
- Signed reports and overdue drafts opened in Review, including redacted views.
- Photo/audio retrieval in documentation and Review, alongside the existing
  media event.
- The reports represented in analytics results, counts, Review analysis/volume/
  workload results and CSV exports, linked to their query/export event.
- Clinical-value inspections in the Audit logs tab.

Each event contains the actor UUID, record agency, accessing agency, patient
UUID, report UUID, action, workflow process, optional media-note or analytics-event UUID, synthetic
flag and database-generated timestamp. Patient and record-agency identities are
resolved from the authorized report, not supplied in request bodies. IDs remain
sensitive personal data; they are not anonymous.

For direct report/media reads, writes share the transaction preparing the response. Every requested record must
produce an event; missing records or failed audit writes prevent the response.
A transaction rollback produces no successful-read event. A committed event
means authorized response preparation, not proof that the client received or
viewed the response. HTTP retries can legitimately create additional events.

Coverage is incremental. Assigned-call lists before a report exists, Review
queues/item discussions, offline browser reads,
denied-access attempts and direct database access are not comprehensively covered
by this new channel. Existing change, recovery and authentication histories remain
separate. Do not infer complete patient-access coverage from an empty query result.
Offline edits acquire their normal change history when the server accepts the
sync. Offline viewing has no event queue and is not backfilled on reconnection.

## Analytics and CSV evidence

Analytics calculations may use a read-only reporting replica. After calculation,
audit events are committed to the primary database before results are released.
No write is attempted on the replica. The primary rechecks that every enumerated
report belongs to the authorized agencies, dataset and own/all report scope;
a missing or mismatched report prevents the response. Query events and their
patient-access references commit together. They record the requesting agency,
actor, surface, operation, date bounds, scope, identifying flag and report count,
with the complete validated request, including search strings and filter literals.
Clinical result values, raw SQL, HTTP headers, session tokens and CSV bytes are not
retained. Raw request bodies are never copied into the evidence: capture uses the
normalized definition and explicitly selected validated parameters.
Each report reference retains that report’s own agency and patient ID; a regional
query therefore remains discoverable in the child agency’s patient-access log.

The **Analytics and exports** details dialog shows scope/date/count metadata and
offers a separate JSON inspection of its captured request. Its event
UUID can filter Patient access to find the represented reports. Empty queries
still produce an event. Catalog element/value discovery is recorded on every
response, including cache hits, but has no enumerated patient population: its
report count is null. Count queries and calculated results enumerate their
matching report population.

Exports first recalculate and record a query. A successful revision check and CSV
serialization are followed by a separate aggregate/record export event before
sending the CSV. A stale-result conflict records the refreshed query but no
successful export. Committed events prove authorized response preparation, not
that the download completed. A later network failure does not erase the evidence.

## Storage, review and operations

The API can append allowed columns but cannot set event IDs/timestamps or update,
delete or truncate the new patient-access, analytics-access and audit-inspection tables. Statement
triggers also reject accidental mutation by privileged operators. No foreign keys
link these events to deletable clinical/account rows, so normal retention and
synthetic deletion do not cascade into the new evidence. There is no automated
expiry for these new tables.

The API's SELECT policy on these three tables requires a transaction-local agency
scope; the audit service also constrains every source query to its authenticated
agency. The runtime database login is trusted application infrastructure and
must remain restricted as described in
[database workload credentials](database-workload-credentials.md). PostgreSQL
owners/superusers can change policies or disable triggers: these tables are not
an independently tamper-proof archive.

`open_triage_patient_audit_reader` is a NOLOGIN role with installation-wide SELECT
on the three new tables. Grant it only to separately authorized operational audit
identities, never the API, ordinary users or analytical workloads. The Admin tab
does not use this role. Direct operational reads are outside the tab's inspection
history and need the operator's existing database-access auditing procedure.

Before production rollout, establish protected archival and backups, monitoring
for audit-write failures and storage growth, clock synchronization, reviewed
retention/disposal rules, and procedures for investigating and documenting log
reviews. Preserve patient/actor/agency identity mappings for as long as their
events need to be interpreted. Keep `DATABASE_LOGGING` disabled in production so
SQL parameters do not duplicate audit identifiers into diagnostic logs. Legacy
log tables retain their existing retention/immutability properties; displaying
them here does not change those properties. In particular, historical clinical
values shown by the dialog remain subject to their source tables’ retention.

## Validation

`packages/database/tests/audit-logs-postgres.integration.test.mjs` verifies the
consolidated migration upgrades an existing agency while preserving evidence,
historical role versions, assignments and custom grants. It checks UUID stability,
unchanged native UUIDs, prerequisites, installation access restrictions, runtime
grants, append-only guards and capabilities for newly created agencies.

`apps/api/tests/analytics-access-audit.test.mjs` and the analytics discovery tests
cover atomic evidence, cache hits, reporting-replica separation, export revision
conflicts and failure before releasing results.

`apps/api/tests/patient-access-audit.test.mjs` covers failure behavior, metadata
minimization, conditional reads, query validation and permissions.
`apps/api/tests/audit-postgres.integration.test.mjs` exercises every section under
the runtime role, tenant isolation, display-name user pagination (including disabled
members and duplicate names), tied-timestamp pagination, append-only grants,
server-owned timestamps, recovery-secret exclusion, identifying permission
boundaries, clinical-value inspections, analytics/report links and survival of
clinical deletion. It runs after the ordinary API integration fixtures in
`npm run test:integration -w @open-triage/api`.

`apps/web/e2e/auditing-panel.spec.ts` covers combined selection, blank/all behavior, retained results through delayed
and failed responses, and stale-response rejection after access revocation, display-name filters, user pagination, row activation,
modal focus and dismissal, access revocation, English/Swedish labels, desktop/mobile
layout and a nondefault agency palette. Run the repository's normal Playwright
workflow, or `npm run check:ci` for the shared local preflight.

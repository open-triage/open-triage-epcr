# Audit Logging PRD

> **Retrospective; implementation reviewed 2026-10-19.** This document records
> the behavior delivered on `feature/audit-logs` through `681ee7e5`, merged in
> PR #746. It reconstructs product intent from the implementation, contracts,
> tests, and [auditing runbook](../runbooks/auditing.md); it is not a new feature
> proposal or a claim of completed production acceptance. It supersedes the
> deferred audit-browser scope in [Admin Controls](admin-controls.md) and the
> [original demo vision](open-triage-demo.md).

## Problem Statement

Agency administrators and authorized auditors need to establish who accessed
patient records, which administrative or clinical operations occurred, and
which records contributed to analytics and exports. Before this delivery,
evidence was distributed across domain histories without a unified agency
browser, and those histories did not provide a common patient-read channel.

Investigations also need stable event references and evidence of audit
inspection itself. Browsing logs must respect agency boundaries and distinguish
permission to inspect administrative activity from permission to inspect
patient-related information. Routine searches should not expose clinical values,
credentials, recovery secrets, or unrestricted database content.

## Solution

The Admin **Audit logs** tab combines permitted event types in one filtered,
chronological table. Auditors can narrow a bounded UTC date range by user or
exact UUID, page through results, and inspect an event in an accessible dialog.
Human-readable labels help interpret evidence while permanent event UUIDs and
recorded identifiers remain available.

Dedicated append-only ledgers record authorized patient reads, analytics and
export preparation, and audit inspections. Covered responses are released only
after their required evidence commits. Existing domain histories retain their
own semantics and retention rules; the browser supplies a common metadata view.
Retained clinical values and analytics/feedback payloads require separate,
authorized inspections that are themselves recorded.

## User Stories

1. As an agency auditor, I want one audit workspace, so that I can investigate activity without manually combining database histories.
2. As an agency auditor, I want access limited to my current agency, so that another agency's evidence is not disclosed through my search.
3. As a regional auditor, I want to switch agencies through the existing workflow, so that each investigation has an explicit agency context.
4. As an administrator, I want separate administrative and identifying audit permissions, so that I can delegate operational review without granting patient-related audit access.
5. As an agency, I want installation authority alone to be insufficient for identifying audit inspection, so that infrastructure administration does not confer patient access.
6. As an auditor, I want to combine selected log types or leave the selection blank for all permitted types, so that related activity appears in one timeline.
7. As an auditor, I want a bounded UTC date interval, so that searches have clear time boundaries and predictable scope.
8. As an auditor, I want to select an agency user by display name, including disabled members, so that historical activity remains searchable after access ends.
9. As an auditor, I want exact UUID search across event and relationship metadata, so that I can follow a known event, actor, patient, report, agency, or related resource.
10. As an auditor, I want permanent event UUIDs, so that references remain meaningful across repeated searches and inspections.
11. As an auditor, I want stable pagination and filtered counts, so that I can understand and traverse a result set without newly created inspection events moving its upper time boundary.
12. As an auditor, I want current actor, agency, and typed target labels alongside retained identifiers, so that evidence is readable even when some referenced records are unavailable.
13. As an auditor, I want outcomes to describe what each historical event establishes, so that an accepted edit is not mistaken for an applied change or a prepared export for a completed download.
14. As a keyboard user, I want to open event details and return focus to the same row, so that inspection preserves my place in the table.
15. As an auditor, I want previous results and their applied-filter label retained while a replacement request is pending or fails, so that a transient failure does not erase my investigation context.
16. As an agency, I want revoked or expired access to clear loaded results and protected details, so that stale responses cannot restore content after authorization is lost.
17. As an identifying auditor, I want explicit access to retained clinical event values, so that I can inspect the recorded change without reconstructing history from today's report.
18. As an identifying auditor, I want analytics request details and execution scope, so that I can understand the search, filters, definition, and population behind a query or export.
19. As an auditor, I want separately authorized feedback payload inspection, so that I can investigate a submission or review without exposing its text in every list response.
20. As an auditor, I want missing historical requests and expired feedback diagnostics clearly identified, so that absent evidence is not silently invented.
21. As an agency, I want every successful audit-list query, including an empty result, and every protected value or payload inspection recorded, so that inspection activity is accountable.
22. As an agency, I want covered report reads recorded before release, so that an audit-storage failure cannot silently permit an unrecorded response.
23. As an agency, I want conditional report reads that authorize cached reuse recorded, so that a 304 response is not treated as an absence of access.
24. As an agency, I want covered report lists, assigned-report openings, Review views, and media retrievals attributed to their actor and workflow, so that access evidence reflects the different ways records are obtained.
25. As a child agency, I want regional analytics access to my reports visible in my patient-access log, so that cross-agency use remains discoverable locally.
26. As an identifying auditor, I want analytics events linked to the reports they represent, so that I can trace a query or export to its patient-access evidence.
27. As an agency, I want analytics discovery and cache-hit responses recorded, so that reusing a cached result does not bypass audit recording.
28. As an auditor, I want empty analytics results distinguished from discovery without an enumerated population, so that zero reports and unknown report count are not conflated.
29. As an auditor, I want successful export preparation distinguished from a stale-result conflict, so that failed export attempts are not represented as completed exports.
30. As an operator, I want analytics evidence committed to the primary database even when calculations use a reporting replica, so that read-only infrastructure remains compatible with audit recording.
31. As an agency, I want new access and inspection evidence to survive ordinary clinical, synthetic-record, and account deletion, so that cleanup cannot erase the audit trail.
32. As an operator, I want application credentials unable to rewrite new ledger events or choose their identities and timestamps, so that ordinary application access cannot alter recorded evidence.
33. As an administrator, I want existing protected roles upgraded without rewriting historical role versions or custom grants, so that audit permissions fit the existing authorization model.
34. As an English- or Swedish-speaking auditor, I want localized controls and responsive layouts, so that the workspace remains usable across supported languages and screen sizes.
35. As an investigator, I want explicit coverage and retention limitations, so that missing events are not mistaken for proof that no access occurred.

## Implementation Decisions

The following are delivered decisions, not proposals for additional modules.

### Module boundaries

| Module | Responsibility and interface |
| --- | --- |
| Audit persistence and identity | Owns the patient-access, analytics-access, and audit-inspection ledgers, database-generated event identities and times, append-only protections, scoped reads, and capability migration. |
| Patient-access recording | Accepts authorized report identities and workflow context inside the response transaction; resolves patient and agency identities from records and requires one event per distinct report. |
| Analytics/export recording | Accepts validated request details, execution scope, and optional report population; commits query/export evidence and report references together on the primary database. |
| Audit browsing and inspection | Provides allowlisted metadata projections, authorization, filters, counts, cursors, bounded label resolution, and separately recorded value/payload inspection through shared API contracts. |
| Admin audit browser | Owns filters, combined results, pagination, accessible details, explicit protected-content loading, and in-memory state tied to current access. |

### Permissions and agency scope

- Every endpoint resolves a live session. The agency comes from that session,
  never a client-supplied organization filter. Parent membership does not produce
  an aggregate child-agency audit view.
- `audit:read` permits administrative audit browsing. Patient access, clinical
  changes, media, recovery, review workflow, synthetic data, audit inspections,
  and analytics additionally require `audit:identifying`.
- `audit:identifying` has a database-enforced `audit:read` prerequisite.
  `review:identifying` is not a substitute. Installation owner and super-admin
  sessions cannot inspect the identifying sections or their protected payloads.
- Existing protected Administrator and Demo roles receive both capabilities in
  a new immutable role version. Historical versions, assignments, and custom
  roles are preserved. Custom roles need explicit grants; new agencies receive
  the capabilities through the protected-role registry.

### Event coverage and interpretation

| Log type | Delivered evidence |
| --- | --- |
| Patient access | Covered authorized report and media reads, analytics report references, and clinical-value inspections. |
| Authentication | Sign-in, session, account, and agency-associated operator account events. |
| Permissions | Authorization, ownership-transfer, and organization history. |
| Configuration | Form/configuration activation, catalog publication, validation, agency settings, and demographics. |
| Clinical changes | Signing, amendments, draft saves, reconciliation, note mutations, and post-signature attempts. |
| Media access | Existing photo/audio access history. |
| Recovery | Offline lifecycle, key lifecycle, and report recovery metadata. |
| Review workflow | Assignment, overdue, progress, saved-analysis, routing, and policy history. |
| Synthetic data | Generation and draft-mutation history. |
| Installations and units | Installation lifecycle and operational-unit changes. |
| Feedback | Accepted submissions and separate review decisions. |
| Audit inspections | Successful list queries and explicit clinical-value or payload inspections. |
| Analytics and exports | Unified Analytics and legacy Review analysis, volume, workload, discovery, counts, and CSV preparation. |

- Direct patient-read coverage includes raw drafts, reopen and active-report
  reads, matching ETag/304 responses, each returned open-report identity,
  assigned-call report opening, signed reports and overdue drafts in Review
  including redacted views, and documentation/Review photo/audio retrieval.
- Direct read recording shares the transaction preparing the response. Missing
  requested records or failed evidence writes prevent release; rollback leaves
  no committed successful-read event. Retries may legitimately add events.
- Patient events retain actor, patient, report, record agency, accessing agency,
  workflow, action, synthetic status, and an optional media/analytics reference.
  Identifiers remain sensitive and linkable; UUIDs do not anonymize the evidence.
- Each source defines its outcome from historical evidence. Examples include
  `authorized` patient access, `prepared` analytics, `accepted` draft commands,
  `reconciled` conflicts, and `not-applied` post-signature edits. Completed unit
  and installation changes show `succeeded`; their rejected attempts are not
  recorded by those sources. Stored failures remain failures, and unfamiliar
  open-ended clinical actions have no inferred success outcome.

### Storage and event identities

- Three dedicated tables hold new patient-access, analytics-access, and
  audit-inspection evidence. Runtime grants restrict inserts to allowed columns
  and deny update, delete, and truncate. Statement triggers also reject those
  mutations; transaction-local agency scope governs runtime SELECT policies.
- Event UUIDs and timestamps are database-generated. Existing UUID source keys
  remain unchanged; numeric sources gain a permanent, unique, immutable
  `audit_id` for retained and future events without changing internal keys.
- The three new ledgers have no cascading foreign keys to deletable clinical or
  account records and no automated expiry. Existing histories retain their
  original retention and immutability properties.
- A separate NOLOGIN operational reader role can read the three new ledgers
  installation-wide. It is not used by the Admin tab and must not be granted to
  ordinary users, the API, or analytical workloads.

### Browsing and API contracts

| Endpoint | Contract |
| --- | --- |
| `GET /api/admin/audit` | Returns metadata entries, permitted categories, a continuation cursor, page number, total pages, and filtered event count. Each successful query records an inspection before returning. |
| `GET /api/admin/audit/users` | Returns current-agency account IDs and display names in pages of 100, including disabled members; requires `audit:read`, not `users:read`. |
| `GET /api/admin/audit/clinical-values/:source/:id` | Returns retained values for an allowlisted clinical event after both audit permissions, agency checks, patient-access recording, and inspection recording. |
| `GET /api/admin/audit/payload/:source/:id` | Returns retained analytics or feedback payload after source, agency, and permission checks and inspection recording; analytics requires identifying audit permission. |

- List requests require `from` and `to` UTC timestamps with a positive interval
  of at most 31 days. `categories` accepts comma-separated allowlisted types;
  omission or a blank value means all permitted types. An explicit forbidden
  type rejects the whole query. Legacy `category` remains supported but cannot
  be combined with `categories`.
- Optional `actorId` narrows by immutable user ID. `uuid` matches complete UUIDs
  case-insensitively across event, actor, target, patient, resource, agency,
  analytics-scope, and inspection-filter metadata. It does not search partial
  identifiers or JSON content. Legacy `targetId` retains its narrower
  target/patient/resource behavior and cannot be combined with `uuid`.
- Selected sources are combined before filtering, counting, and ordering by
  time, source, and event UUID. Pages contain at most 50 entries. Cursors retain
  microsecond precision and the first page's upper event-time bound. Empty
  results display page 0 of 0. Counts are recomputed, so deletions or late events
  with earlier timestamps can still change totals during traversal.
- Metadata projections exclude clinical values, free text, request payloads,
  session tokens, recovery handles, and key material. Label lookups are bounded
  to authorized page references and the applicable agency boundary; shared
  catalog labels and referenced cross-agency analytics names are supported.
- Current display names, username fallbacks, typed targets, PCR/call numbers,
  unit call signs, and configuration names improve readability. Missing records
  retain typed references. Labels are current display metadata, not historical
  snapshots; patient names and clinical values are not used as target labels.
- List inspections record reviewer, agency, queried types, requested time
  bounds, optional filters, and returned count, including zero. Explicit value
  and payload inspections identify the source and event UUID. Historical
  inspection references are preserved without inventing missing event links.
- All endpoints return `no-store, private` responses. There is no audit-log
  download/export endpoint.

### Protected values and analytics evidence

- Clinical inspection returns only retained historical values: prior/new values
  for signing or amendments, submitted draft changes, discarded conflicting
  values, or attempted post-signature changes. Other sources remain metadata
  only. Both patient-access and inspection writes must succeed before release.
- Analytics captures validated definitions, searches, filter literals, grouping,
  dates, selections, and export parameters with actor, requesting agency,
  execution scope, identifying flag, and report count. It does not retain result
  values, raw SQL, HTTP headers, tokens, arbitrary request bodies, or CSV bytes.
- Calculations may use a read-only reporting replica. Before release, the
  primary rechecks each enumerated report against the authorized agencies,
  real/synthetic dataset, and own/all scope, then atomically commits the analytics
  event and patient references. References retain each report's agency and
  patient identity, including reports used by a regional query.
- Empty queries still record events. Discovery responses, including cache hits,
  record a null report count because they enumerate no patient population;
  count queries and calculated results record their matching report population.
- CSV export recalculates and records a query first. A valid revision and
  successful serialization are followed by a separate export event before CSV
  release. A stale revision records the refreshed query but no successful export.
- Feedback payloads include original submission content, attribution, and
  retained diagnostics; review payloads also include that review's approved
  summary, note, and attribution. Expired/missing diagnostics are marked
  `not-retained`. Older analytics requests that were not captured are explicitly
  absent, with the recorded summary available instead.

### Browser interaction

- One chronological table starts with event UUID and localized log type. A
  collapsible type selector, UTC dates, display-name user selector, and Any UUID
  filter control applied results; changing filters restarts pagination.
- Row activation by click, Enter, or Space opens details. The dialog contains
  focus, supports Escape/Close, and returns focus to the same row. Full
  identifiers are available in a collapsed section.
- Clinical values and JSON dumps load only on explicit inspection. Protected
  content stays in component memory and is discarded on collapse, close, or
  access revocation; reopening performs a fresh authorized request.
- Pending or failed list requests retain the previous table with its original
  applied-filter label. Revoked or expired access clears results; stale responses
  cannot repopulate cleared or closed views. Audit data is not persisted in
  browser storage.
- Controls use English/Swedish localization and the shared UI conventions,
  including responsive layouts and agency colors. Recorded event codes retain
  their source values.

## Testing Decisions

Good tests verify externally observable behavior: what a caller can obtain,
which evidence commits, which operations fail, and what an auditor can see and
operate. All five delivered modules have corresponding coverage. This
retrospective records existing tests rather than proposing new implementation
or implying that the suites were rerun while writing documentation.

| Module | Existing verification and prior art |
| --- | --- |
| Persistence and identity | Database migration integration coverage upgrades an existing agency, preserves evidence, native UUIDs, historical role versions and custom grants, and checks UUID immutability, capability prerequisites, runtime grants, append-only behavior, installation restrictions, and new-agency roles. |
| Patient-access recording | API tests inject missing records and write failures, check conditional reads, permissions and metadata minimization, and extend existing report, call, media, and Review workflow fixtures. Runtime-role integration exercises tenant isolation and evidence survival after clinical deletion. |
| Analytics/export recording | Tests check validated request capture, atomic unique report references, primary/replica separation, cache hits, empty/discovery behavior, revision conflicts, and refusal to release results or CSV when recording fails. Existing discovery-cache and Review CSV tests provide the surrounding workflows. |
| Browsing and inspection | Unit and PostgreSQL integration tests cover every section, outcomes, forbidden mixed selections, source/query validation, exact UUID search, tied timestamps, page boundaries and totals, disabled/duplicate-name users, scoped labels, secret exclusion, protected payloads, and inspection failures. |
| Admin browser | Playwright covers combined/blank filters, pending and failed requests, stale-response rejection, pagination totals, user loading, typed labels, explicit protected-content inspection, revocation, keyboard/focus behavior, English/Swedish, mobile/desktop widths, enlarged text, and a nondefault agency palette. |

Database/API integration tests require a configured PostgreSQL fixture; browser
tests follow the repository's Playwright workflow. The shared pre-PR gate is
`npm run check:ci`, covering application, browser deployment, database, and scale
preflight. The [local development runbook](../runbooks/local-development.md)
documents prerequisites, and the [auditing runbook](../runbooks/auditing.md#validation)
identifies the concrete suites. Test presence does not establish production
readiness or prove complete patient-access coverage.

## Out of Scope

- Comprehensive logging of offline browser viewing, denied-access attempts,
  assigned-call lists before a report exists, Review queues/item discussions,
  and direct database access. Offline views are not queued or backfilled;
  accepted offline edits retain their normal server-side change history.
- A parent-agency aggregate audit browser, generic database viewer, infrastructure
  stdout/PostgreSQL log viewer, or display of unassociated operational events
  and the separate operations query-audit ledger.
- Audit-log export/download, automated anomaly detection, scheduled review,
  review conclusions/sign-off, or case-management workflows.
- Reconstructing missing historical analytics requests, missing clinical values,
  or source events that were never recorded.
- An independently tamper-proof archive, automated expiry for the new ledgers,
  or replacement of existing domain-history retention policies.
- Certification, a legal-compliance conclusion, or confirmation of production
  rollout and operational acceptance.

## Further Notes

- This is an as-built synthesis. The problem framing and user stories express
  inferred intent supported by repository behavior, not recovered quotations
  from an earlier requirements interview. Existing modules and tests define the
  recorded scope; operational requirements below remain separate acceptance work.
- Apply the consolidated audit migration before the corresponding API. UUID
  population rewrites existing numeric source tables and holds locks during the
  migration transaction; large installations need an appropriate maintenance
  window. The [auditing runbook](../runbooks/auditing.md) is the rollout reference.
- Committed read/export events establish authorized response preparation, not
  receipt, viewing, or download completion. A later network failure does not
  erase evidence, and an empty search does not prove absence of access.
- Database owners/superusers can change policies or disable triggers. Protected
  backups and archival, audit-write failure/storage monitoring, synchronized
  clocks, reviewed retention/disposal rules, and procedures for documenting log
  reviews are operational dependencies, not guarantees supplied by this UI.
- Preserve patient, actor, and agency identity mappings for as long as evidence
  must be interpreted. Keep production SQL parameter logging disabled to avoid
  copying identifiers into diagnostic logs. Direct operational reads require
  the operator's existing database-access audit procedures.
- Historical clinical values and feedback diagnostics remain subject to their
  source retention rules. New-ledger survival does not guarantee that every
  older domain-history row or display label survives deletion.

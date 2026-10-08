# Product requirements documents

These documents record product intent and the scope of successive delivery
milestones. **Status reviewed against the repository on 8 October 2026.**
An older PRD's problem statement or Out of Scope list describes that milestone,
not necessarily today's product. Follow its delivery/supersession note before
using it as a roadmap.

The [README user guide](../../README.md#user-guide) describes current user-facing
workflows. “Implemented” below means the workflow is present in the repository;
it is not a claim that all acceptance, device, operational, or clinical-readiness
checks are complete. Code, tests, runbooks, and current issue evidence remain the
authority for delivered behavior.

## Original milestones and broader direction

| Document | Role | Current interpretation |
| --- | --- | --- |
| [OpenTriage demo](open-triage-demo.md) | Broad original product vision | Partly delivered and superseded by focused PRDs. Amendment authoring UI, general audit browsing, and dedicated print/PDF remain broader goals. |
| [OpenTriage MVP](open-triage-mvp.md) | Historical first prototype | Delivered through issue #54; the static, single-scenario scope is superseded by the server-backed application. |
| [Admin controls](admin-controls.md) | Broad administration direction | Users, roles, configuration, and selected agency settings are implemented. Dedicated unit/vehicle, general history/audit, and integration-management screens remain deferred. |
| [Admin controls MVP](admin-controls-mvp.md) | Historical first administration slice | Catalog/form publication foundation implemented through #252; later features supersede its placeholder and exclusion lists. See the [representative validation runbook](../runbooks/admin-controls-mvp-representative-validation.md). |

## Feature specifications

| Document | Repository status | Boundaries and follow-up |
| --- | --- | --- |
| [Mobile call flow](flow-mobile.md) | Assigned/open calls, autosaved drafts, and synchronization implemented | Login prefill and automatic replacement demo calls were superseded by Users and Roles. Signing remains Stationary-only. |
| [Stationary workflow MVP](stationary-workflow-mvp.md) | Full-form editing and signing implemented | Later authoring PRDs replace the source-only layout boundary; Review provides signed-report follow-up. |
| [Dispatch payload](dispatch-payload.md) | Payload ingestion, revisions, provenance, and assignment projection implemented | See [vendor integration](../vendor-dispatch-integration.md). Live vendor adapters and quarantine-management UI are separate work. |
| [Protected offline clinical storage](protected-offline-clinical-storage.md) | Encrypted persistence and online recovery implemented | Supersedes plaintext/offline-restart assumptions. Device enrollment and vehicle linking remain deferred; see the [operating boundary](../protected-offline-clinical-storage.md). |
| [Users and roles](users-roles.md) | User/role administration, sessions, ownership, and Clinical Demo implemented | Later role revisions give Administrator full access and Demo access without publishing. Review extends the original registry. External identity, MFA, and self-service forgotten-password delivery remain deferred. |
| [Custom elements and form editor](custom-elements-and-form-editor.md) | Custom-field/group authoring and expanded form controls implemented | Supersedes earlier default-value behavior: forms control choices and ordering; opening a field does not fill a configured default. |
| [Validation authoring](validation-authoring.md) | Rule authoring, publication, activation, and runtime evaluation implemented | Review now supplies the formerly deferred review workflow; Metric Library extends the shared configuration. See [validation rollout](../runbooks/validation-rollout.md). |
| [Report media notes](report-media-notes.md) | Text, live photo/audio notes, Stationary viewing, and agency media settings implemented | Photo/audio capture validated on Android/Chrome and iOS/Safari by project-owner confirmation on 2026-10-08. See [recorded device coverage](../runbooks/media-device-browser-validation.md). |
| [Localization](localization.md) | English/Swedish UI, agency regional settings, and versioned definition translations implemented | Additional languages need dictionaries and definition translations; absent translations fall back to English. |
| [User feedback](user-feedback.md) | Online bug/feature submission and operator review tooling implemented | See [feedback review](../runbooks/feedback-review.md); feedback messages must not contain patient-identifying information. |
| [Review and basic analytics](review.md) | Scoped review, assignments, discussion, outcomes, and overdue follow-up implemented | Retrospective APIs and a standalone panel exist, but the panel is not connected to the current workspace. Unified Analytics and Metric Library supersede the original analytics presentation and metric selection. |
| [Unified analytics workspace](unified-analytics-workspace.md) | Line/Bar/Table workspace, filters, CSV exports, and personal saved visualizations implemented | Metric selection now uses Records and review-enabled configured metrics/rules. Workload-analysis UI, sharing, and scheduled reports remain outside this workspace's scope. |
| [Metric library](metric-library.md) | Numeric metrics and Boolean rules share the Validation lifecycle and feed Analytics | See [metric behavior and limits](../runbooks/metric-library.md). Trauma-destination and aspirin example rules remain disabled pending definition of unresolved mappings. |

## Keeping requirements current

When a PRD is replaced, keep it here as design history and add a prominent
supersession note linking to its replacement. New PRDs should use lowercase,
kebab-case filenames and be added to this index.

Keep implemented behavior, unverified acceptance work, and future scope distinct.
An out-of-scope item is not automatically a delivery commitment. Record later
decisions beside the affected requirement, and link to implementation or operational
evidence where it helps resolve an older assumption.

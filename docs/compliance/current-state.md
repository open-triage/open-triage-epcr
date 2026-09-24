# Current platform assessment

Baseline and limitations: [overview](README.md). Legal IDs refer to the
[legislation register](legislation.md).

“Implemented support” means code was inspected for a relevant mechanism, not that
the complete requirement is satisfied. “Documented” means an intended operational
control is described but deployment evidence was not inspected. “Not established”
does not prove absence throughout the repository or region; it identifies evidence
that this review cannot supply. No framework is marked fully conformant.

## Evidence and gaps

| Area / law | Current evidence | Assessment and remaining work |
| --- | --- | --- |
| Identity and sessions — L01–L03 | [Session service](../../apps/api/src/sessions/clinician-session.service.ts), [controller](../../apps/api/src/sessions/clinician-session.controller.ts), [password hashing](../../apps/api/src/identity/password.ts), [throttling runbook](../runbooks/authentication-throttling.md). Local credentials use salted scrypt; random session tokens are stored as hashes. Code checks expiry, revocation, account state and credential version. Browser cookies are Secure/HttpOnly/SameSite; CSRF and reauthentication controls exist. | Implemented support. The inspected login is password-only; a compliant MFA chain is not established. Re-entering the same password is not a second factor. Identity proofing, staff lifecycle, production federation, emergency access and timeout configuration need deployment validation. |
| Authorization — L01–L03 | [Draft service](../../apps/api/src/reports/draft-report.service.ts) and [signing service](../../apps/api/src/reports/sign-report.service.ts) check capabilities, organization and documenting clinician. [Database boundary tests](../../apps/api/tests/database-boundary.test.mjs) and [workload credential runbook](../runbooks/database-workload-credentials.md) address database boundaries. | Implemented support, not a completed needs/risk analysis. Validate every endpoint, care-team/shift handover, privileged support, exports and emergency access against real clinical roles. Owner-only record access may also impede necessary care. |
| Record integrity and authorship — L02–L03 | [Signing service](../../apps/api/src/reports/sign-report.service.ts), [amendment service](../../apps/api/src/reports/amend-report.service.ts), [signing tests](../../apps/api/tests/sign-report.test.mjs). Version checks, explicit attestation, snapshots, provenance and correction/audit mechanisms are present. | Partial support. Validate the complete signed-record and amendment journeys, author attribution, timing and readable historical rendering. An application “signature” is not demonstrated to be an advanced/qualified eIDAS signature; neither is assumed universally required. |
| Patient-access logging — L02–L03 | Authentication events, clinical change/signature audit and [analyst-query audit policy](../database-operations-policy.md) exist. The inspected `DraftReportService.get()` loads a record without an explicit patient-access audit write. | Full read/access coverage is **not established**. Change history and sign-in logs are not substitutes for patient-access logs. The analyst policy intentionally omits patient identity and retains metadata for 365 days; it cannot alone satisfy L03. Design and validate a separate protected access-log channel, including offline access. |
| Offline confidentiality — L01–L03, L09 | [Protected browser storage](../../apps/web/app/protected-clinical-storage.ts), [server recovery-key service](../../apps/api/src/reports/protected-report-key.service.ts), [storage design](../protected-offline-clinical-storage.md), [browser compatibility policy](../browser-state-compatibility.md). AES-256-GCM records, report-scoped keys, recovery envelopes, reauthentication grants and expiry mechanisms exist. | Implemented support with explicit exclusions: compromised OS/extension, active same-origin compromise and unlocked memory. Fully offline revocation is delayed. Device inventory, registration and decommissioning are documented as deferred. Validate browser eviction, connectivity loss, expiry, clock changes and lost-device response in ambulances. |
| Security operations — L01, L03, L04, L09 | [API security headers](../../apps/api/src/security-headers.ts), throttling, CSRF tests, secret requirements and [database operations runbook](../runbooks/database-operations.md). Production offline recovery requires a dedicated wrapping secret. | Controls and operating instructions exist. Independent testing, patch response, software/component inventory, endpoint management, incident exercises, transport/storage encryption configuration and staffing are not established. API headers do not establish web-application or infrastructure security. |
| Retention and archives — L02, L08 | [Retention policy](../retention-archival-deletion-policy.md), [runbook](../runbooks/retention.md) and [machine-readable policy](../../packages/database/config/retention-policy.json) specify archive verification, holds, restricted deletion and hash-linked evidence. | Documented support with material legal questions; see below. No deployment archive authority, verified archive service or lawful disposal schedule was inspected. |
| Availability and recovery — L01, L03, L06, L09 | [Operations policy](../database-operations-policy.md) and [runbook](../runbooks/database-operations.md) describe backups, recovery objectives, replicas, key escrow and verification. | Documented, not demonstrated on a production installation. Prove restore and key recovery, alerting, outage operation, recovery objectives and support escalation. Backup and archive serve different purposes. |
| Analytics and secondary use — L01–L02, L12 | [Analytical privacy boundary](../analytical-privacy-boundary.md) describes HMAC patient keys, excluded identifiers/narrative, separate analyst roles and controlled identified views. | Pseudonymization support, not anonymization. Exact clinical values/timestamps remain. Assess linkage/reidentification, each purpose and recipient, exports, retention and whether quality-register/research rules apply. A project privacy approval is not the region's DPIA. |
| Clinical content and configuration — L02–L04, L06 | [Data-model guide](../data-model-authoring.md), [validation rollout](../runbooks/validation-rollout.md), [form publication tests](../../apps/api/tests/form-publication.test.mjs), [validation tests](../../apps/api/tests/validation-authoring.test.mjs). Catalogs/forms/validation are versioned; a Sweden-oriented configuration is available as an inactive option. | Useful configuration controls. Swedish clinical completeness, terminology, identity handling and professional approval are not established. NEWS/WEST/SATS are proposed additions, not validated features. Documentation validation must not be described as validated clinical decision support. |
| Integration and interchange — L01–L03, L11–L12 | [Vendor dispatch integration](../vendor-dispatch-integration.md) and [canonical data-model guide](../data-model-authoring.md) document provenance, canonical JSON and versioning. | No general Swedish EHR/Inera/EHDS conformance established. Individual-record NEMSIS XML interchange is explicitly unsupported. Test each actual interface, identity match, units, chronology, duplicate/conflicting messages and recipient authorization. |
| Usability/accessibility — L04, L06, L15 | [Accessibility journey tests](../../apps/web/e2e/accessibility-journey.spec.ts) include automated checks and mobile interaction scenarios. | Tests are useful but not a full accessibility assessment or clinical human-factors validation. Assess gloves, motion, lighting, interruptions, time pressure, screen readers and error recovery on approved hardware. |
| Feedback and vigilance — L01, L04, L07 | [Feedback service](../../apps/api/src/feedback/feedback.service.ts), [review runbook](../runbooks/feedback-review.md), [diagnostic retention](../runbooks/feedback-diagnostic-retention.md). | Feedback workflow and bounded diagnostic retention support operations. They are not a validated vigilance/CAPA system or regulatory reporting channel. Free-text submissions can still contain patient information; restrict and review them. |
| Regulatory/QMS evidence — L04–L07 | Product documents, source history, test suites and runbooks exist. | No institution-approved device file, QMS evidence set, clinical evaluation, Annex I matrix, public Article 5(5) declaration or IVO notification evidence was established in this review. These cannot be inferred from CI or repository availability. |

## Specific discrepancies to resolve

### Authentication documentation does not match the inspected implementation

The [offline-storage document](../protected-offline-clinical-storage.md) refers to
Supabase session/JWT validation. The current inspected API instead uses
`app_identity.local_credential` and `app_identity.app_session` through its own
session service. Do not rely on the stale Supabase wording when assessing
revocation or purchasing identity controls. Reconcile the architecture, code,
tests and operational documentation. This review did not inspect a live Supabase
project or change any identity configuration.

### Retention defaults need a Swedish deployment decision

The existing policy uses ten years of **online** retention, allows approved
organization-specific settings from 1–100 years, and selects records using the
reporting date. These controls do not demonstrate that the last-entry-based
minimum, later amendments and public-record preservation are satisfied. A shorter
online period may be permissible only with a legally adequate, accessible archive;
it cannot shorten the required overall preservation period.

The deletion workflow can remove transactional, audit and analytical rows after
archiving. Review exactly which evidence survives, its retrievability and the
authority for each deletion. Application-owner approval and an object checksum
are not substitutes for regional archival/disposal decisions. See L02 and L08.

### Keep operational diagnostics distinct from legally necessary audit evidence

Metadata-only diagnostic logging is a useful minimization measure. It must not
prevent a separately protected audit channel from recording legally required
patient/user attribution. Clinical correction history may itself contain patient
data. Define each log's purpose, access, retention, integrity and export policy;
avoid a blanket “logs contain no patient identifiers” claim. See L01–L03.

### Demo, migration and deployment safeguards need clinical hardening

The [README](../../README.md) documents optional fixture accounts with known
initial credentials and synthetic-record expiry. The [validation rollout](../runbooks/validation-rollout.md)
also includes an explicitly confirmed unsigned-clinical reset procedure, while
browser startup removes legacy plaintext clinical keys. An unsigned record is
not automatically disposable, and a development migration is not clinical data
migration approval.

Before real-data use, approve and test migration/rollback, prohibit accidental
fixture access and synthetic classification of real records, restrict destructive
tools, and preserve any existing clinical work through a lawful migration path.
The [public demo](../demo-deployment.md) is synthetic-data-only; its deployment
pipeline is not a validated regional clinical release process.

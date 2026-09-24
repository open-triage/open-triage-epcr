# Agency Settings hardcoded-value inventory

Status: human-reviewed for issue #501 on 2026-09-24. The approved migration set is appearance/sign-in presentation and canonical NEMSIS dAgency demographics. This inventory remains the prioritized source for deferred candidates.

Safety classes are `preference`, `security`, `legal retention`, `clinical protocol`, `interoperability`, `deployment`, `schema invariant`, and `fixture only`. `P0` means a safety boundary that must not become a casual setting; `P1` is the next deliberate product review; `P2` is lower-priority follow-up.

| ID | Candidate and current owner/location | User impact and rationale | Safety class and dependencies | Disposition | Priority |
|---|---|---|---|---|---|
| 1 | Report media allowance; `app_identity.agency_settings`, contracts, API and Admin panel | Caps canonical photo/audio bytes per report; agencies own storage policy | Preference; quota pinning, grandfathering, database capacity warning | Already delivered by #491 | Complete |
| 2 | Agency display name; `app_identity.organization.name` | Identifies the signed-in organization | Preference; profile validation, revision and audit | Keep canonical organization ownership; future Agency Profile UI | P1 |
| 3 | Agency time zone; `organization.deployment_timezone`, calls/reports services | Controls local chronology display | Interoperability/clinical correctness; IANA validation and historical-display decision | Keep canonical organization ownership; deliberate Agency Profile follow-up | P1 |
| 4 | Shift-session duration, default 14 hours and bound 1–72; `organization.shift_session_duration_hours` | Controls authenticated access lifetime | Security; owner approval, floor, immediate-session semantics | Defer to security settings review | P1 |
| 5 | Static 720-minute session and 30-minute idle values; installation JSON | Duplicates or does not drive runtime policy | Security; usage audit and compatibility cleanup | Consolidate separately; do not expose | P1 |
| 6 | Minimum password length and scrypt parameters; installation JSON and `identity/password.ts` | Controls credential strength and hash cost | Security floor; threat/performance review | Non-configurable safety floor | P0 |
| 7 | Temporary-password lifetime, 72 hours; installation JSON, provisioning services and CLI SQL | Controls temporary credential exposure | Security; one authoritative source and CLI compatibility | Deliberate security follow-up | P1 |
| 8 | Recent reauthentication window, 5 minutes; sessions and recovery SQL | Gates high-impact actions and key recovery | Security assurance invariant | Keep fixed | P0 |
| 9 | Authentication throttle windows/counts/backoff and ingress limits | Brute-force resistance and availability | Security/deployment; coordinated threat and capacity review | Keep non-agency-configurable | P0 |
| 10 | Ownership-transfer expiry, 72 hours; service and database constraint | Controls account takeover window | Security and accountability; API/DB parity | Keep fixed | P0 |
| 11 | Offline recovery, default 24 hours, 1–168 bound, restart reauth required; organization columns and recovery SQL | Controls PHI recovery availability | Security/privacy; owner reauth, key lifecycle and deadline-shortening tests | Deliberate owner/security follow-up | P0 |
| 12 | Download, audit-export and configuration-export booleans; installation JSON | Controls data egress | Security/legal; export workflows and audit design | Defer until workflows exist | P1 |
| 13 | Ordinary clinical retention, default 10 years; organization and `retention.policy` | Determines legal record lifetime and deletion eligibility | Legal retention; obligations, archives, holds, approved publication | Never expose as a casual setting | P0 |
| 14 | Synthetic record expiry, exactly 24 hours; retention migrations | Limits demo clinical-data lifetime | Privacy/product invariant; complete dependent purge | Keep fixed | P0 |
| 15 | Feedback diagnostic retention, 30 days; feedback expiry migration | Limits diagnostic metadata lifetime | Privacy/legal operations | Separate policy review | P2 |
| 16 | Sign-in brand/helper text; formerly static installation JSON | Gives public, agency-specific sign-in guidance | Preference with pre-auth safety; no credential/secret disclosure | Migrated in #501 through revisioned Agency Settings | Approved |
| 17 | PNG logo, light/dark accents, browser/PWA colors and names; CSS/layout/manifest defaults | Provides agency-local accessible branding | Preference; bounded PNG validation, WCAG contrast, CSP-safe activation, fixed severity colors | Migrated in #501 through revisioned Agency Settings | Approved |
| 18 | dAgency.01, dAgency.02 and dAgency.04; immutable `agency_demographic_version` | Supplies report-linked NEMSIS agency identity | Interoperability; catalog constraints, immutable versions and report pinning | #501 adds authorized version creation without duplicating the source of truth | Approved |
| 19 | Default Stationary form, per-unit default, units and agency demographics | Selects documentation and operational identity | Clinical/interoperability; dedicated versioned domains | Keep out of generic settings | P0 |
| 20 | Text-note 10,000-character and planned caption 500-character limits | Bounds clinical-record content | Clinical/schema; client, API and DB parity | Keep fixed | P0 |
| 21 | Photo/audio capture rules: live-only, rear camera, 2560 px, metadata removal, five minutes, AAC and MIME allowlist | Protects provenance, privacy, fidelity and resources | Clinical/media safety | Not agency settings | P0 |
| 22 | Six quick actions, order, Stationary sidebar layout/filter/default | Determines workflow presentation | Clinical UX or user-local preference | Keep product/user-local | P2 |
| 23 | Save debounce, sync retry and call/report polling intervals | Affects latency, load and reconciliation | Deployment/engineering; load and offline testing | Inventory until concrete product bounds are approved | P2 |
| 24 | Clock-skew, recovery-grant, transaction retry and timeout values | Controls conflict ordering and reliability | Security/schema invariant | Not user-facing | P0 |
| 25 | Validation resource limits, input lengths, UUID/version/state constraints and append-only triggers | Prevents unbounded execution and invalid state | Schema/security invariant | Not configurable | P0 |
| 26 | NEMSIS release/build, schemas, code systems, dispatch semantics and normalization | Defines external exchange meaning | Interoperability | Change only through versioned standards/catalog migration | P0 |
| 27 | Clinical validation, requiredness, signing severity/acknowledgements and form defaults | Determines clinical protocol and signing | Clinical protocol; existing Catalog/Form/Validation workflows | Keep in purpose-built versioned domains | P0 |
| 28 | Helm hosts, replicas, resources, ingress, cron, projection batches/retries/freshness, PG timeouts and ports | Controls cost, availability and service topology | Deployment-only | Keep Helm/operator-owned; read-only Admin status later | P1 |
| 29 | Backup/WAL/RPO/RTO/replica/query-audit policy | Controls disaster recovery and compliance | Deployment/security/legal; external accounts, KMS and storage | Runbook/owner governance only | P0 |
| 30 | Synthetic credentials, UUIDs, unit/demographics/scenarios/forms | Provides deterministic idempotent demonstrations | Fixture only; identity stability | Never expose as settings | P0 |
| 31 | Feedback caps, Admin search/page sizes and bounded authoring text | Limits abuse, privacy exposure and query cost | Engineering/schema safeguard | Keep fixed | P2 |

## Evidence-backed product decisions

- `docs/prds/report-media-notes.md` user stories 64–72 and Agency Settings decisions explicitly approve the report media quota and require inventory rather than automatic exposure of risky values.
- `docs/prds/admin-controls.md` user stories 41 and 74–78 explicitly identify agency profile/demographics, time zone, general policy and accessible appearance as administrator-owned. The same PRD requires independently versioned domains, immutable report pins, WCAG contrast, fixed clinical severity colors and exclusion of agency-local appearance/profile from portable packages.
- `docs/prds/flow-mobile.md` explicitly places the 14-hour shift-session duration at organization scope but defers its Admin UI.
- `docs/prds/protected-offline-clinical-storage.md` explicitly stores the recovery window and restart-reauthentication policy per organization while deferring a recently reauthenticated, owner-authorized mutation path.
- `docs/prds/admin-controls-mvp.md` previously described demo flags as settings; `docs/prds/admin-controls.md` and `docs/prds/users-roles.md` supersede that choice by requiring the protected Clinical Demo role and prohibiting installation-level demo profiles and credential banners.
- `docs/database-architecture.md` and `docs/database-prd.md` make dAgency demographics immutable versioned reference data pinned by each report; #501 therefore appends canonical versions instead of copying these fields into Agency Settings.

## Approved migration behavior

- Appearance and sign-in copy share the existing organization-scoped Agency Settings revision, `settings:read`/`settings:write` authorization, optimistic concurrency, immediate activation and append-only audit path.
- Public sign-in configuration contains presentation only. Helper validation rejects credential/secret disclosures. Logos are PNG data URLs no larger than 128 KiB and 1024×1024; audits retain only the logo digest.
- Accent colors require 4.5:1 contrast against white. Clinical severity colors, layout, typography and interaction semantics remain fixed.
- A demographic change appends an immutable `agency_demographic_version` under its existing catalog release. New reports select it; existing reports retain their pinned version. The audit event records bounded dAgency old/new values and content hashes without copying clinical content.

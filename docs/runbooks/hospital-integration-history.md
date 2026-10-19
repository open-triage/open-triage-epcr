# Inspect hospital integration evidence

Admin → Audit logs is the history interface. Select **Integrations** for COS/EPS
operational events, EPS previews and import decisions; **Configuration** for
shared integration configuration changes; **Patient access** for EPS reads; and
**Review workflow** for queued recovery commands and transmission findings.
Filter by time, actor or UUID, then open a row for its recorded metadata.
Integration settings contain configuration controls only, with no History tab.
Configuration imports are explicitly distinguished from edits for newly recorded
changes; older events retain their original recorded meaning.

COS confirmations currently identify simulator evidence explicitly. They do not
prove live Cambio storage. EPS hackathon acceptance does not establish production
readiness or complete terminology acceptance.

`audit:read` permits metadata for all log types, including integration, Review,
configuration and patient-access events, including UUIDs and record identifiers.
Clinical values and expanded payloads require `audit:identifying`; installation authority does not imply
this grant. Operational status never includes patient names, clinical source
values, full payloads, remote diagnostic bodies or credentials. Canonical mapping
exports contain mapping definitions, not protected connection settings or local
staff identity assignments.

Audit events include stable report, source, snapshot, attempt, command and mapping
references where available. Search the existing audit browser by UUID to correlate
configuration/test/activation, EPS reads/imports/submissions, COS failures, recovery
and eventual acknowledgement. Automatic worker events remain distinguishable from
human commands. Retained reconciliation evidence distinguishes fenced non-storage
from unresolved outcomes; no missing result is treated as a successful delivery.

Recovery commands provide only an authorized link to the related Review work. The link
checks the live report, agency, dataset, expiry and report-relative identifying
Review grant again when opened. Inspecting status or possessing audit authority
does not authorize resend, retry, reconciliation or access to the clinical report.
Those actions remain in ordinary Review and reauthorize independently.

Clinical copies—including prepared payloads/PDFs, imported source evidence and
simulator copies—follow ordinary report/synthetic retention even after delivery
failure. A separate append-only ledger retains only typed operational metadata,
with no clinical foreign key that could preserve a payload. Expired reports have
no live Review link. Audit-reader scope and existing protected audit retention
apply independently; the ledger does not replace protected audit archival.

# Inspect hospital integration evidence

Hospital integrations → History provides a read-only, paginated operational view.
Choose the clinical or fictional dataset and optionally filter by destination or
report UUID. Select a row to inspect the exact signed snapshot/amendment,
configuration revision, canonical mapping identity/revision/hash, attempt count,
retry explanation and immutable event history. Earlier failures and superseded
versions remain separate evidence after eventual success. Configuration imports
are explicitly distinguished from edits for newly recorded changes; older events
retain their original recorded meaning.

COS confirmations currently identify simulator evidence explicitly. They do not
prove live Cambio storage. EPS hackathon acceptance does not establish production
readiness or complete terminology acceptance.

`settings:read` permits redacted operational status. `audit:read` separately permits
the existing audit browser and operational metadata. EPS patient-access history
continues to require `audit:identifying`; installation authority does not imply
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

Both surfaces provide only an authorized link to the related Review work. The link
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

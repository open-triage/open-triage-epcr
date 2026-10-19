# COS simulator delivery

Activating a tested COS configuration enables durable automatic delivery for newly
signed transported-care reports. Existing signatures are never discovered or
backfilled. The signature transaction records its active configuration revision,
canonical mapping identity/revision/hash and actor alongside the immutable snapshot.
Signing performs no receiver call, rendering, or identifier validation. Missing
mapping fields, identifiers or media therefore cannot block signing.

Activation and signature enqueue share the group configuration lock. The active
state row is locked within signing's existing SERIALIZABLE transaction; concurrent
activation/deactivation causes its bounded transaction retry. An initial signature
whose database snapshot predates the first configuration is not backfilled. A
signature started after activation commits observes it. Deactivation pauses pending
work; it cannot recall a receiver call already in flight. Reactivation retains the
original queued configuration even when another revision is active.

The API runs bounded simulator worker batches automatically every five seconds.
A database advisory lock serializes each report across API instances. A pending
job survives restart. The worker records an immutable prepared payload, exact PDF
bytes and digest, mapping provenance and attempt before invoking the receiver. The job pins the agency language at signature time;
later language changes cannot alter a queued artifact. Preparation holds a shared
lock on activation state through durable intent, so deactivation commits either
before preparation (paused) or after the attempt has become in flight.
It commits uncertain intent before any possible receiver effect. A crash after
that point remains uncertain: this slice never blindly resends it. The internal `remapWaitingCos` building block requires configuration authority and
scoped identifying report access, expected active-state/configuration revisions and
an idempotent command UUID. It only remaps waiting work with no payload/attempt,
creates an immutable child lineage on the chosen active mapping, and supersedes
the parent without changing its recorded configuration. Uncertain or confirmed
work cannot be remapped. Later Review recovery slices expose the authorized command
and reconciliation workflow; this slice adds no public retry endpoint. Definite rejection, missing
information, pending work and confirmed storage remain distinct.

This is the explicit `opentriage-cos-simulator-v1` development contract. It performs
no external network calls and does not prove live Cambio operation. Its contact and
note storage commit independently from the worker. Contact identity uses the
configured encounter namespace plus stable report UUID. The encounter identity must match on repeated commands. Signed patient corrections
are explicitly supported by this simulator contract: the immutable initial contact and
prepared payloads retain identity history, while the current contact/note pointer
changes atomically when the replacement note is stored. This does not establish live
Cambio support for patient reassignment. The note command uses the durable delivery UUID and content
hash. Success requires the receiver's stored note receipt plus matching structured
payload and PDF hashes, not merely acceptance of a contact or request.

The clinical adapter constructs a COS collection Bundle with a v2
QuestionnaireResponse, never an EPS document Bundle. It supports explicitly mapped
string fields under the published `otherInformation` slice; one occurrence becomes
one item with one answer. Unsupported values or NOT/pertinent-negative qualifiers
fail instead of becoming asserted free text. PDF content still includes the full
signed report. The admin panel's PDF SNOMED link identifier is part of canonical
mapping JSON. No code is invented: legacy mappings preserve their original hash and
remain importable, but require an explicit new revision with that field for delivery.
The simulator binds its `valueUri` to exact PDF bytes out of band. This URI is not a
public download route or a verified live COS attachment URL.

Initial eligibility requires explicit NEMSIS patient contact (`eDisposition.27`),
patient evaluation/care (`eDisposition.28`) and patient transport (`eDisposition.30`).
Cancellation/no-contact dispositions are excluded. Other or ambiguous dispositions
wait; non-transport eligibility is implemented by the next delivery slices. The
configured destination pair matches `eDisposition.01` (destination name) and
`eDisposition.02` (destination code) exactly. No free-text similarity or fallback
hospital routing is used. Patient field, namespace, staff identity, template and
care unit all come from the recorded canonical/local configuration.

Authorized Review report users see redacted delivery state and actionable findings.
Reopening the report refreshes it. Report/agency/dataset/revocation authorization is
shared with ordinary report reads; configuration privileges alone grant no clinical
inspection. Worker authority is specifically the activated, signature-created job
bound to the same agency, report and snapshot; it does not impersonate an end user.
The delivery event journal records either the signing actor or a worker UUID and
attempt reference. Routine errors never contain identifiers, clinical text or secrets.

Prepared payloads and simulator copies are private clinical tables, not Data API
resources. They cascade through the existing report/snapshot retention deletion;
immutable triggers allow only the established authorized retention/synthetic purge.
There is no artifact endpoint or separate indefinite retention window. Signed photo
verification and PDF limits remain those in [signed-report-pdf.md](signed-report-pdf.md).
No audio bytes are delivered. Actual OAuth, contact lifecycle, template codes,
attachment retrieval/limits and final acknowledgement remain ticket 024 acceptance.

Structured simulator payloads are bounded before item allocation: at most 10,000 signed occurrences, 2,000 mapped clinical items, and 1 MiB of source text and projected text each. The serialized Bundle is capped at 2 MiB, including JSON escaping. Exceeding any bound records `simulatorLimit` with no truncation and no receiver effect. These are explicit simulator limits, not verified live COS limits.

## Signed amendments and replacement ordering

Every new signed amendment under active configuration queues its exact snapshot and
amendment sequence, with the active canonical mapping identity/revision/hash. It uses
the effective signed clinical values and amendment author/time, while its PDF retains
original signer and complete amendment provenance. No package activation rewrites
an existing version. Missing configured amendment staff identity waits explicitly.

Signing supersedes older pending/waiting work only when it has no prepared payload
or attempt. The worker locks the report before activation/delivery rows during
preparation, then releases that transaction before receiver I/O. The session report
lock serializes sends across workers. Any uncertain attempt remains a durable barrier
to newer work after crash or lock loss; a timeout never establishes rejection.
Authorized reconciliation is a later Review workflow, not an automatic retry here.

The simulator stores immutable note receipts and exact PDF bytes for each delivered
version, and one `cos_simulator_current` pointer per report/contact. A conditional
monotonic replacement rejects an older version even when called directly after a
newer version was stored. Identical delivery replay is idempotent; another delivery
at the same sequence cannot silently replace it. Receipt history and current pointer
share report retention. Actual remote late-processing guarantees remain ticket 024.

### Missing transmission identifiers in Review

An eligible signed report with missing identifiers creates built-in operational
Review work; no authored validation rule is needed and signing remains successful.
Two stable conditions distinguish patient identity (documenting clinician by
default) from integration mapping (shared queue by default). Review settings can
route either condition to the clinician, an eligible named reviewer or the shared
queue. Ineligible routing targets recover through the existing Review mechanism.

Each condition shows all remaining requirements, the pinned patient-field
identity/label and mapping/version evidence to viewers with report-relative
identifying access. The queue and commands retain their ordinary agency, dataset,
assignment and current-session restrictions. Configuration editing remains a
separate permission; authorized users can open Hospital integrations from the
condition. Others receive administrator guidance.

Repeated identical evaluations do not duplicate work. Changed evidence and later
recurrence keep the same item and its prior history. A generic Review outcome
cannot close an unresolved technical condition, enforced in the API and database.
Only reconciliation of the selected signed/configuration version clears it.
Documenting a corrected identifier and explicitly revalidating configuration
are subsequent workflow slices; this condition does not mutate signed values or
resend an uncertain delivery. Evidence contains no patient identifier value and
expires with its report under the ordinary synthetic retention workflow.

### Deliberate recovery from Review

The first failed or uncertain delivery opens one stable **COS transmission failed**
Review concern per report. It defaults to the shared queue; ordinary clinician,
named-reviewer and shared routing, assignment and agency/dataset scope apply.
A later failure reopens the same concern and keeps its prior evidence and attempts.
Only confirmation of the latest delivery resolves it. Queueing and retry clicks
keep it open, and generic Review completion is blocked in the API and database.

The assigned reviewer with live report-relative identifying access can deliberately
retry a definite `outage`. The command pins the item version, latest signed
amendment, active configuration/state and immutable mapping. It records the manual
actor and selected version. The same per-report advisory lock coordinates commands
and workers; stale or duplicate clicks cannot make parallel attempts. The worker
reuses the verified prepared Bundle/PDF/contact bytes and appends a new attempt.
There is no automatic retry schedule in this slice.

Payload, credential and identity findings require the indicated correction. An
uncertain remote result blocks resend, including after process restart and newer
amendments. Integration configuration changes require deliberate revalidation;
retry never silently translates or changes the clinical payload or recipient.
Audit event details and report status link to the authorized Review concern. They
have no Retry control. Recovery evidence and commands expire with the report.
This remains the explicit development simulator; actual Cambio acceptance is the
separate ticket 024 gate.

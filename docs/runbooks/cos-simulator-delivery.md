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
configured encounter namespace plus stable report UUID. Contact content must match
on repeated commands. The note command uses the durable delivery UUID and content
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

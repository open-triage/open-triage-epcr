# COS uncertain outcome reconciliation candidate

This is the local persistent simulator contract `simulator-fenced-status-v1`.
It is not a Cambio endpoint or evidence of real COS interoperability. Live
activation remains blocked pending ticket 024 verification of the receiver's
acknowledgement mechanism, operation cancellation/fencing and version semantics.

Every real worker operation carries its immutable delivery and attempt IDs.
Receiver mutations acquire a report key-share lock followed by a receiver lane
lock before checking the exact attempt fence. Contact identity stays stable;
note/receipt insertion and the monotonic current-note pointer are one transaction.
Legacy in-process callers lacking attempt bindings fail conservatively after a
fence and cannot provide verified stored proof.

An authorized assigned identifying reviewer requests reconciliation, never a
resend. The command uses the shared report worker lock and live session/CSRF,
agency, dataset, item version and configuration-state checks. The simulator's
status implementation tries the receiver lane without waiting. Busy lanes,
missing prepared bytes, broken hashes, conflicting contact identities and
missing/mismatched original-attempt bindings leave the outcome unresolved.
A missing row or HTTP timeout alone is never non-delivery evidence.

With the lane held, exact note/PDF hashes, stable contact key, original attempt,
delivery identity and receipt prove final storage. Otherwise the simulator must
persist a durable rejection fence for the exact original attempt before it can
prove note non-delivery. A partial contact remains reusable. The next attempt
is created only through the existing coordinated retry command, subject to its
configuration pause, amendment and bounded retry policy. Reconciliation never
resets a retry budget. An obsolete version is superseded after fenced proof,
allowing its newer signed version to proceed without replaying the old version.

Immutable commands record actor, attempt, timestamps, receipt and hashes, with
separate known/rejected/uncertain contact, note and storage evidence. They contain
no credentials, clinical values, unrestricted bundle or PDF bytes. Identifying
Review access is required for this history.

Report retention cascades through evidence, receiver rows and fences. Every
receiver mutation first locks and requires the report, and subsequent inserts
retain report/attempt foreign keys. A purge skips an already-running writer and retains its fence until a later pass;
a writer starting after purge finds no report and cannot recreate receiver rows
or bypass a removed fence. No tombstone is needed for this in-process receiver;
a real remote receiver needs its own durable retention-safe operation contract.

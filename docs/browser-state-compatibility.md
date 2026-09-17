# Browser-state compatibility and recovery

The protected-storage rollout ends browser compatibility with every plaintext
clinical persistence format. At application startup and after every identity
transition, the browser deletes the old encounter, per-report, synchronization,
offline queue, raw-recovery, and category-named keys. It never imports, copies,
or rewrites those values. A production browser can create persistent clinical
state only as an authenticated encrypted record in the protected IndexedDB
store described in [Protected offline clinical storage](protected-offline-clinical-storage.md).

The version 4/5 local-storage parser remains a non-browser pure compatibility
fixture for historical unit tests and static-demo development. Browser entry
points return before that parser and all browser writes return before touching
local storage. It is not a production migration or recovery path and must not
be called from browser code. Future protected-envelope versions preserve an
incompatible authenticated ciphertext record intact; they must not export raw
clinical JSON into another browser store.
## Protected offline ciphertext rollback boundary

The server stores a monotonic revision-and-hash checkpoint after a protected
ciphertext revision is synchronized. It rejects an older revision and rejects a
different ciphertext at the same revision. Revisions created only in a browser
that has never synchronized cannot have a server checkpoint; complete loss or
rollback of every copy of that browser profile remains outside the server's
detection boundary. Unsynchronized ciphertext is therefore never a storage
pressure eviction candidate.

## Offline authorization-revocation window

An already unlocked report can remain readable while the browser is fully
disconnected because no server decision is available. That residual window
ends at the earlier of the shift-session expiry or the next successful server
contact. A 401 or 403 authority decision drops the in-memory report key and
locks editing immediately. The server independently locks the recovery
envelope when `clinical:document` is removed; the browser retains only opaque
ciphertext until its original recovery deadline.

Restoring `clinical:document` before that deadline permits the original user to
recover through recent reauthentication. It never extends the deadline.
Account deactivation, deletion, organization removal, or an administrator's
explicit recovery purge destroys the wrapped keys for every browser. Password
reset revokes sessions and outstanding grants but deliberately preserves an
otherwise eligible envelope until its existing deadline.

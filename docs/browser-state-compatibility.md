# Browser-state compatibility and recovery

The approved automatic compatibility window is the current browser persistence
version and the immediately previous version. Each previous version remains
supported for at least one complete release cycle after its successor ships.
When a new current version is introduced, its implementation must retain and
test the version it replaces; an older migration may be removed only in a later
release after it falls outside this window.

The current window is:

- Version 5 is the native canonical-document envelope written by the app.
- Version 4 is the only automatically migrated format. Its canonical document,
  extension events, workflow drafts, compatible extensions, and custom data are
  carried into version 5. The separately persisted offline report queue is not
  rewritten during this migration, so pending commands retain their exact
  serialized representation.
- Versions 2 and 3, unversioned payloads, and unknown future versions are not
  interpreted or migrated. The old category-named storage key is also not
  reinterpreted as current clinical state.

Unsupported or malformed payloads produce an explicit `invalid` or
`incompatible` load result. Before the source key is removed, its original
serialized value is copied without parsing or reserialization to
`open-triage:standard-encounter-v1:recovery`. The application must not create a
fresh draft over that condition; recovery state remains available until the
user explicitly resets local progress. This preserves the original clinical
draft bytes for support-assisted recovery without silently applying an unsafe
legacy conversion.
## Protected offline ciphertext rollback boundary

The server stores a monotonic revision-and-hash checkpoint after a protected
ciphertext revision is synchronized. It rejects an older revision and rejects a
different ciphertext at the same revision. Revisions created only in a browser
that has never synchronized cannot have a server checkpoint; complete loss or
rollback of every copy of that browser profile remains outside the server's
detection boundary. Unsynchronized ciphertext is therefore never a storage
pressure eviction candidate.

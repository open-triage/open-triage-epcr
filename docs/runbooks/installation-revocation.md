# Installation revocation

Under Admin → Units → Installations, choose **Revoke** for the lost or retired
browser/PWA installation, review its name and the offline warning, then confirm.
The action requires current `settings:write` authority in the selected agency.
Inactive units retain their inventory so their registrations can still be revoked.

Revocation ends the immutable registration's server authority and all application
sessions associated with that registration, regardless of the clinician using it.
It does not revoke the clinician's sessions on other devices. User-session
revocation remains the separate Users/Sessions action. The installation lifecycle
audit identifies the registration, actor, device scope and affected session count.
Repeated revocation is idempotent and does not create another lifecycle event.

Connected clients reassess their session every 30 seconds and on focus,
visibility changes and reconnection. A denied session uses the existing protected
storage lock: pending writes settle, readable clinical state and keys close, and
eligible encrypted pending work keeps its existing recovery deadline. Subsequent
server requests deny the revoked session immediately. A request authorized before
the revocation commits may already have completed; this action cannot undo it.

An offline device cannot receive the revocation until it reconnects. It remains
bounded by its existing local session deadline. Revocation is **not remote erasure**.
Do not assume that a disconnected device has already locked or that retained
ciphertext has been deleted. Unit/report/author history remains unchanged.

An administrator can issue a fresh authorized enrollment QR for a revoked
installation. Consumption rotates its installation credential and creates a new
immutable registration for the same stable installation identity. It never
reactivates the old registration or old sessions. The clinician must sign in again
before recovering their own eligible pending work through the established recovery
workflow; enrollment cannot extend recovery or offline deadlines.

Application sessions store the server-owned registration association separately
from clinician identity and selected agency. Initial enrollment also associates
an existing live, same-origin, authorized clinician-cookie session when it has no
previous binding. Stale/expired cookies do not obstruct independent enrollment.
Password completion retains the previous session's binding; agency switching
does not replace it. All session issuers share a PostgreSQL guard that serializes
association against registration revocation and rejects reassociation. Registration
and unit/agency/group activity are checked when session authority is assessed.

The service, runtime-role PostgreSQL and EN/SV browser regressions are required
by `npm run check:ci`. Browser tests exercise the real session gate, reconnection,
mobile keyboard confirmation and retention of pending IndexedDB ciphertext with
an unchanged recovery deadline.

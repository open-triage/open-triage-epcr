# Installation revocation

Under Admin → Units → Installations, choose **Revoke** for the browser/PWA
installation's unit pairing, review its name and the scope explanation, then
confirm. The action requires current `settings:write` authority in the selected
agency. Inactive units retain their inventory so their registrations can still
be revoked.

Revocation ends that immutable registration's unit-job authority. It does not
revoke personal application sessions, prevent personal sign-in, or withdraw
existing authorized reports, protected-report recovery, Administration or Review.
Use the separate Users/Sessions action to revoke personal access. The installation
lifecycle audit identifies the registration, actor and unit scope; the retained
`sessionsRevoked` response field is zero. Repeated revocation is idempotent.

Call-list refresh removes incoming unit calls and shows enrollment is required
for new calls. Opening a new assignment independently checks the live registration
under locks, so a stale call card cannot grant access after revocation commits.
This applies equally to production and generated synthetic calls. Calls generated
by a Demo user are delivered to any authorized clinician paired to the target unit;
Demo permission is required to generate them, not to receive them. Their synthetic
classification, generator provenance and expiry remain intact.

An offline device cannot receive changed unit context until it reconnects, and its
ordinary personal session and protected-work deadlines still apply. Revocation
is **not remote erasure**. Protected ciphertext, report history and recovery
deadlines remain unchanged. Recovery still requires the report owner, current
personal authority, fresh proof and the existing one-use recovery grant.

A stale or revoked installation cookie does not obstruct a fresh personal login.
The new session is unpaired. Existing sessions retain their historical registration
association, but that association cannot grant unit-job access once revoked.
Password completion copies only an available active registration into its new
session. Unit inactivity likewise withdraws unit jobs without disabling personal
identity or authorized retrospective work.

An administrator can issue a fresh enrollment QR for a revoked installation.
Consumption rotates its installation credential and creates a new immutable
registration for the same stable installation identity. It never reactivates the
old registration. Initial enrollment can attach an existing live same-origin
session that has no prior association. A session associated with a retired
registration must sign in again to acquire the new association; it can continue
its existing authorized work meanwhile. Pairing never extends a session or
recovery deadline.

Reassignment remains a separate explicit context transition: it signs out the
old clinician context before rotating the registration to the incoming unit.
See [Installation enrollment](installation-enrollment.md).

Regression coverage includes runtime-role PostgreSQL sign-in, unit-job races,
existing-report recovery and EN/SV browser notices and transitions. Run it with
`npm run check:ci` after the complete set of changes is ready for validation.

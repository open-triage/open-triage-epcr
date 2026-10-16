# Installation enrollment

Under Admin → Units, an agency administrator opens Installations for an active
unit and issues a five-minute, single-use QR. The QR includes only an opaque
random enrollment token in a URL fragment. Open the link in the intended browser
or installed PWA. The compact confirmation page names the
selected unit, requires an installation name and explicit confirmation, and
never consumes a code automatically. A scanner that opens another browser must
open the original link in the intended installation before confirming. The page
removes the code from browser history immediately. Refreshing an unpaired page
therefore shows “No pairing code”; reopen the original QR link to continue.

The installation credential is a separate Secure, HttpOnly, SameSite=Strict
cookie scoped to `/api`; JavaScript receives only inventory metadata. It remains
when clinician logout removes the clinician session and locks protected records.
Enrollment confers no user session, role, agency access or clinical authority.
Clearing all site data or changing browser/PWA storage context requires another
code. Existing inventory entries remain. Clearing only clinician localStorage
is a logout, not removal of the installation cookie.

Enrollment requires a secure browser context and Web Locks support. Requests
serialize across tabs before bootstrap can set an installation cookie; unsupported
browsers fail closed. PostgreSQL serializes enrollment by the installation
credential and enrollment token, rejects expiry after waiting for locks, and
uniquely enforces one live registration per stable installation identity.

The stable installation identity is separate from immutable agency-scoped
registration and enrollment history. Future reassignment must revoke the old
registration, rotate its credential and create a new scoped registration for the
same stable identity. Never change historical agency/unit references in place.
Device revocation is documented in [Installation revocation](installation-revocation.md). Production job gating is delivered by a subsequent slice.

Admin issuance/inventory require current `settings:write` authority in the
selected agency. Issuance and consumption require active agency/group/unit state.
Tokens are scoped to the issuing browser origin. Only the exact independent
bootstrap POST routes with the non-simple `x-installation-enrollment: 1` header
bypass clinician-cookie CSRF checks, so expired clinician cookies cannot prevent
enrollment. The random token and explicit confirmation remain required.

Lifecycle audit stores IDs, issuing administrator, event kind and time. Never
log enrollment tokens, installation credentials, request bodies on enrollment
routes or patient data. Standard URL access logs do not receive the QR fragment.

Run the service/CSRF/cookie tests, real PostgreSQL enrollment integration test,
and `installation-enrollment.spec.ts`; all are included in `npm run check:ci`.
Browser coverage uses independent storage and expired clinician-cookie scenarios,
confirmation, keyboard/mobile layout, logout persistence and site-data clearing.
Physical Android scanner/browser/PWA context selection still requires deployment
acceptance on the intended devices; desktop automation is not hardware testing.

## Reassigning a live installation

Issue a new five-minute single-use QR from the incoming unit's Installations
inventory. Open it in the enrolled browser or PWA, confirm the incoming unit and
intended installation, then choose **Reassign and sign out**. The installation
keeps its stable identity; its old registration stays in history and a new
registration receives a rotated HttpOnly credential. The old credential no longer supplies unit-job access. Associated clinician
sessions are signed out by this explicit reassignment; a fresh personal login
with a retired cookie is allowed as an unpaired session.

Confirmation first tells every signed-in tab to use the normal protected-storage
lock lifecycle. The transition waits for those tabs to settle pending local
writes and release readable keys before submitting the QR. A suspended tab may
need to be brought to the foreground or closed before reassignment can complete.
Eligible unsynchronized ciphertext remains within its original recovery deadline.
A failed pairing leaves the browser signed out; request a fresh QR if necessary.

Sign in with personal credentials after reassignment. Pairing never carries a
clinician session into the new context. Recovery remains subject to the original
author's server authorization and deadline; another clinician cannot recover
those keys. Existing reports retain their agency, unit, author and pinned form.

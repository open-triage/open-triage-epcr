# Installation-wide Android upgrade policy

The installation owner and installation superadmins can configure **Super-admin →
APK upgrades**. The policy is shared by every agency on this server. Agency
administrators can still obtain the approved APK through Agency Settings, but
cannot read privileged policy administration or change its grace period.

The default is 90 days. Allowed values are whole days from 0 through 365,
inclusive; 0 means no grace after the explicit supersession date. Changes take
effect when the server transaction commits and apply to existing retirements.
They do not move a release's supersession date. Reducing grace can make an
existing deadline immediately overdue, and extending grace can reopen its grace
period only while the client remains supported. The preview shows current and
proposed compatibility outcomes and effective UTC deadlines before Save appears.

The policy has an optimistic revision. Save also checks a fingerprint of the
exact release descriptors, lifecycle metadata, current server protocol and
capabilities, and verified replacement availability shown by the preview. A
changed policy, changed release selection, withdrawn verification, or expired
verification while waiting for another writer rejects Save with a conflict;
reload and preview again. APK verification occurs before the policy write lock.
The transaction rechecks the exact live login after waiting, then uses the fresh
cached verification without downloading under the lock. A revoked or expired
login cannot commit a waiting write. The operation uses the current valid login;
there is no additional authentication prompt.

Every actual change appends an installation-wide audit record to
`app_identity.android_upgrade_policy_event`, with actor, server time, old/new
policy and release-input digest. A no-op does not increment the revision or
append an event. The ledger is append-only, contains no session credentials, and
has no browser, Data API or reporting-role grants. Policy mutation is authorized
by the existing installation-owner/superadmin authority; agency role capabilities
do not grant it. Runtime RLS additionally requires a live installation superadmin
as the update/audit actor. The singleton is seeded by migration and the API has
neither insert nor delete authority for it.

## Publishing a retirement

The immutable release descriptors and versioned URLs live in
`packages/contracts/config/android-releases.json`. Keeping a historical descriptor
there does not override format, protocol or capability checks. Candidates 1 and 2
retain their exact previously published descriptors. Candidate 2 remains the
first catalog entry; the explicit `ANDROID_APPROVED_RELEASE` deployment selection
still controls what administrators and clients can download.

Retirement is an explicit reviewed deployment input in
`packages/contracts/config/android-release-lifecycle.json`:

```json
{
  "schemaVersion": 1,
  "retirements": [
    {
      "versionCode": 1,
      "supersededAt": "2026-01-01T00:00:00.000Z",
      "replacementTag": "android-candidate-2-0.1.0-rc.2"
    }
  ]
}
```

This example is synthetic. **The checked-in live lifecycle has no retirements.**
Do not add a live retirement until the replacement has passed the required signed
upgrade and retained-work recovery acceptance. Use an exact UTC timestamp, a
known predecessor version and an approved replacement with a higher version code.
Never derive this date from app installation, first connection, server startup,
container deployment, release-file modification time, or the device clock.
Preserve an established supersession date through later server deployments.

For an otherwise supported predecessor, a deadline is effective only when its
exact named replacement is the selected, digest-verified, server-compatible APK:

`deadline = supersededAt + graceDays × 24 hours`

The server evaluates the deadline using its own current time; equality is
expired. Reinstalling an old APK cannot restart it. If the verified replacement
becomes unavailable or the operator selects another artifact, retirement
enforcement is suspended for otherwise supported clients until the named update
is available again. The fixed supersession date is retained, so availability
restoration restores the same deadline, which may already be expired. This never
makes an unknown version or an unsupported protocol, storage/recovery format or
required capability compatible. Those outcomes require an update regardless of
grace or replacement availability.

## Client contract

`GET /api/android/compatibility?versionCode=<installed-version-code>` returns
`compatible`, `approaching-upgrade`, or `upgrade-required`, with a reason,
server time, effective deadline or null, policy revision, grace days, and a verified
compatible replacement route with a higher version code when available. Unknown versions and unsupported
contracts return `upgrade-required` without a grace deadline. A supported release
without an effective retirement remains `compatible`.

The endpoint requires either a live enrolled-installation cookie at its registered
origin or an authenticated application session. A supplied revoked enrollment is
rejected rather than falling back to another identity. This lets the APK obtain
policy after pairing and before personal login without issuing a personal session
or exposing policy actors, audit details, other clients or privileged admin data.
The response is private and `no-store`. The server advertises `android-upgrade-policy-v1`; future APK descriptors require
that capability, so an enrollment-only server cannot silently supply this policy.
The native gate in ticket 016 consumes this
contract and preserves encrypted drafts and their independent recovery deadlines.
This policy endpoint does not itself discard work or extend recovery deadlines.

## Validation

An early API unit check boots the actual Android providers through Nest with all
optional catalog, lifecycle and fetch overrides omitted. This exercises production
constructor defaults before database integration. Foundation HTTP fixtures retain
bootstrap exceptions as named test failures instead of terminating the whole file.

`npm run check:ci` runs the shared evaluator tests, localized Super-admin browser
journey, and real PostgreSQL policy/authorization/HTTP integration suite. The
focused DB suite checks cross-agency consistency, persisted defaults and edits,
preview conflicts, append-only audit/RLS/grants, exact deadline restoration after
an APK outage, unsupported capabilities, and revocation while waiting on a real
policy row lock. HTTP coverage checks both native enrollment authority and normal
session CSRF. `npm run android:build` validates the instrumented policy check;
`npm run android:test -- --skip-build` exercises the pre-login policy read through
the actual native HTTPS/cookie boundary during manual pairing acceptance.

## New-work enforcement and retained documentation

Current Android packages send `X-OpenTriage-Android-Version` from the installed
`PackageInfo.versionCode` through the native transport. JavaScript cannot supply
or override this header. Future packages require `android-upgrade-gate-v1` as well
as the policy capability, so a server that only displays policy cannot appear to
provide authoritative enforcement. This declaration is compatibility metadata,
not binary attestation or personal/device authorization.

The server evaluates policy before committing a new dispatched report, standalone
incident/report, or synthetic assignment. It verifies replacement bytes before
opening the clinical transaction, locks the shared policy before person/device/
session rows, and samples the server clock when actually asserting new work.
A concurrent policy save cannot slip between policy evaluation and report creation.
No grace value restores unsupported formats. Unknown or malformed declared
versions receive `426 android.upgradeRequired`. Missing version metadata on an
installation with a native enrollment-attempt receipt receives the same outcome,
including when only its previously bound personal session accompanies the request.

Immutable candidates 1 and 2 predate version declarations and native enrollment
attempt receipts. Android's legacy `HttpURLConnection` agent is boundedly recognized
as `Dalvik/... (Linux; U; Android ...)`; without newer native provenance or an
explicit declaration it is conservatively evaluated as the exact approved
`android-candidate-1-0.1.0-rc.1` baseline. The server never assumes latest/current
for an unreported version. Missing or incompatible baseline fails closed.
Retiring candidate 1 therefore retires unversioned legacy APKs too. Ordinary
browser user agents and browser enrollment receipts retain their browser contract.
These compatibility signals never grant authority, and cannot attest to a binary.

Retirement alone does not lock or reset the current report. Authorized owned
report reopening, already-open call retries, idempotent create-command replay,
saving, signing and eligible recovery keep their existing authorization and
expiry rules. Additional documentation within an already owned incident continues
under its pinned configuration. New independent incidents remain gated. The
localized notice does not replace the mounted clinical workspace or rewrite its
encrypted pending record. When online, it uses the authorized server evaluation
and links to the approved replacement. An unavailable policy check blocks new-work
controls while existing documentation remains usable.

The current upgrade acceptance runner registers the exact new B descriptor and
verified B bytes only through its synthetic API's explicit test providers. It
starts with no retirement, prepares real pending work on immutable A, then retires
A and proves its actual legacy transport refuses new work. It stages B through
Android Package Installer and abandons that session before commit, proving A
remains installed. The ordinary `install -r` upgrade then retains the original UID,
Keystore/pairing/CA/managed settings and exact pending ciphertext through offline
restart and authorized recovery. The final installed B must successfully start
new work. These additional assertions are required before publishing a package
that declares the upgrade-gate capability. No synthetic catalog or retirement is
written to the production catalog, and no published candidate is modified.

Unsupported retained envelope metadata or an authenticated future payload produces
an explicit localized recovery-material notice. The original encrypted bytes stay
unchanged and the report remains read-only; the runtime does not initialize a new
key/envelope or replace that material with an empty current-schema record. Normal
online recovery remains available for supported records under its original policy.

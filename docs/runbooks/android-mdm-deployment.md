# Managed APK deployment and retained-work upgrades

Use the ordinary production package `org.opentriage.android`, its permanent signing
identity and the exact release selected in Admin. The clinical application is never
the device owner. See [approved downloads](android-downloads.md),
[managed configuration](android-managed-configuration.md) and
[release verification](android-release.md).

## Selected acceptance environment

On 2026-11-12 the owner authorized a comparable open-source product instead of
supplying an Intune tenant. Tickets #815/#816 therefore use Headwind MDM Community
with its real upstream agent and standard Android application restrictions. This
does not establish Intune, an unavailable combined MDMesh deployment, physical
phone/tablet acceptance, or a production rollout.

The prepared isolated lab uses official image `headwindmdm/hmdm:0.1.9` at digest
`sha256:3550b48408407fca8ce692017e8e1be7bbf3442629d33de4072eb73b6188325e`.
The downloaded server WAR is actually **5.40.1**, SHA-256
`c1b00198773cbd888d668448e39826fee778cceb40b4e87db89ea453a9f18bdf`.
The removable upstream agent is **6.40 / 15400**, source
`75eff13e7e3faf2fbe0c4d22f42d24da2a139f69`, APK SHA-256
`4a5e6d618a21b1e0b7c7edccb0ee8948ebcbb7ccc8f693491ad72d237106d3a8`.
Its debug manifest adds `testOnly=true`; the other lab changes are local server
URLs and the private matching server shared secret. The bundled production agent
6.37 is not the removable test agent. Preserve these distinctions in evidence.

The management console and notification service bind only to loopback, with a
separate disposable database. HTTP on this isolated management path never changes
the application's HTTPS/TLS policy. Credentials, session state, shared secrets and
full configuration snapshots stay in private ignored files, mode `0600`.

**Completed substitute lab evidence:** on a fresh Android 13 emulator assigned to
dedicated configuration 4/device 3, the real agent installed candidate 4 and
upgraded to 5. The actual Admin-selected candidate 5 and anonymous public download
matched the approved bytes. Independently pulled installed APKs matched the
immutable descriptors and permanent signer, with UID 10175 unchanged:

| Release | Installed APK SHA-256 | Bytes |
| --- | --- | --- |
| 4 / `0.1.0-rc.4` | `4068cedc6ff57af63dce392029ba43cba4f619cdf967cb1627aedbbfbff17773` | 9,364,250 |
| 5 / `0.1.0-rc.5` | `e1eeffd1438d4b64be598a0928de0742e89d9c12993a2eab1d81539d134ad552` | 9,364,142 |

The managed upgrade preserved exact encrypted pending work, enrollment, CA,
pinned versions and original recovery deadline. Foreground reconnect, process
termination, different-user denial and authorized online recovery passed. Actual
origin/CA conflicts, invalid typed policy and explicit empty Bundle blocked the
UI and retained sealed credentials; valid policy restored the current login.
Administrative test-owner removal produced an empty Bundle and blocked UI; this
was device-side withdrawal, not server remote wipe. Installation revocation kept
the valid personal session (200), denied new work (403), and left the unopened
assignment and original server report metadata unchanged. Revocation-stage proof
covers sealed connection/server metadata; the preceding upgrade established native
ciphertext preservation. Deleting the final server setting produced a bounded
stale-policy observation after receipt and three OS reads; explicit `{}` delivery
cleared policy successfully. This does not assert a permanent vendor defect.

The completed lab's configuration/overrides, Home, radios/display and reverses
were restored; its removable agent was uninstalled with clinical version 5/data/UID
preserved. See the sanitized [deployment acceptance](https://github.com/open-triage/open-triage-epcr/pull/833)
and [policy acceptance](https://github.com/open-triage/open-triage-epcr/pull/836)
records for exact-source checks and scope. This establishes the owner-approved
Headwind substitute lab, with no Intune, combined MDMesh,
[physical phone/tablet](android-physical-acceptance.md) or human rollout acceptance.

## Deploy and observe

1. Obtain an exclusive disposable Android 13+ device lease. Record serial/API,
   original Home activity, owners, reverse mappings, radios and display settings.
   Never reset a device containing retained clinical work. Install only the
   verified removable agent as device owner; OpenTriage retains an ordinary UID.
2. Select the approved release in Admin. Verify the actual downloaded APK's
   descriptor, length, SHA-256, signer and package metadata using
   `npm run android:verify:download -- --release <approved-tag>` and the configured
   SDK. Do not rebuild or resign an existing release code.
3. Import those same bytes into Headwind's Android application catalog. Record the
   actual application/version IDs and public management download URL. Independently
   stream that URL and compare the exact approved digest and length. A successful
   upload or matching filename alone is insufficient. Do not send console cookies
   to APK downloads or permit redirects onto another origin.
4. Use a dedicated configuration and device. Preserve private original complete
   configuration and device-setting snapshots before changes. In the configuration,
   select the clinical application's exact version with **Install** (`action: 1`),
   no remove action and no skip-version option. Confirm the device's actual
   `configurationId`; an application in the catalog is not a deployment assignment.
   Leave `com.hmdm.launcher` untargeted: selecting the bundled production 6.37 agent
   could replace the independently installed removable 6.40 test build. The
   acceptance validator rejects agent install/remove actions in this configuration.
5. Deliver all three standard keys through the real agent. Use integer
   `configurationVersion: 1`, the approved HTTPS `serverOrigin`, and string
   `publicCaPem` containing only the public CA bundle (or explicit empty string
   for system trust). Keep PEM newlines/types intact. Pair using a matching Admin
   artifact, confirm vehicle, complete ordinary initial sign-in and foreground
   synchronization. Verify conflicting pairing is refused before credential transfer.
6. Observe real `RestrictionsManager` values and application managed state, not
   merely the server's saved setting. Record policy update/reconnect and removal
   results. Upstream agent updates only packages represented in its processed
   settings map: deleting the last server row must not be assumed to clear old
   Android restrictions. A stale-agent limitation remains an external finding;
   manual `setApplicationRestrictions`, Test DPC or clearing app data cannot replace
   real delivery evidence.
7. Request current inventory after deployment. Headwind's inspected upstream
   `DeviceInfoProvider` records package and **version name only**; its console green
   state is also name-based. Catalog `versionCode` can be zero. Independently observe
   installed Android code, name, signer, APK SHA-256 and byte length, ordinary UID and observation time. Require
   both inventory and Android observations after the deployment start timestamp.

## In-place upgrade and revocation

Create a durable encrypted pending edit while offline, record only non-secret
digests and approved metadata, then terminate the process abruptly. Retain the
original UID, Keystore-decryptable connection, CA, pairing, exact encrypted payload,
form/report/version pins and recovery deadline. Do not print draft contents,
cookies, clinician identities or encryption keys.

Import the higher-code same-signer approved release through the same management
route and update the dedicated configuration's selected application version. Capture
the complete policy and device assignment before and after. Verify that application
settings still target `org.opentriage.android` and contain identical keys, types,
values and substitution/readonly flags. Do not assume Intune's reassignment rules
apply to Headwind: test the actual selected server/agent transition. Missing or
conflicting policy must block the clinical app without an unmanaged fallback.

Let the real management agent install the update in place. Record server inventory,
independent installed metadata and identical UID; do not substitute `adb install -r`
for proof of MDM distribution. Relaunch offline and verify no report plaintext is
revealed. Reconnect, use the existing valid login or ordinary initial login after
real session loss, recover as the original clinician, and synchronize. Confirm the
original protected-work boundaries and genuine-write deadline rules; the upgrade
must not create a new recovery deadline. A different clinician remains denied.

Test actual supported device-management revocation and installation/vehicle
revocation separately. Removing a server inventory row is not by itself proof that
Android cleared policy or that the clinical server revoked an installation. Verify
fresh installation-authorized new-work requests are denied after actual installation
revocation; observe the personal session and retained work independently. Do not use a factory reset,
wipe, uninstall or app-data clear as a revocation experiment with pending work.

Finally restore the saved lab configuration/device overrides, remove only the
removable test agent's owner, and restore Home, reverse mappings, radios and display
settings. Preserve the clinical installation and retained evidence. Cleanup failure
is a failed run, not a successful acceptance result.

## Reproducible checks and evidence

Run the clean-checkout early checks before an expensive device run:

```sh
node --test tests/android-mdm-*.test.mjs
npm run check:ci
```

The ordinary Android workflow already includes `tests/android-*.test.mjs` before
build/device tests. These checks cover wrong-target/remove/skip-version mistakes,
lost configuration, version-name-only or stale inventory, and altered/redirected APK
bytes without depending on generated workspace output.

`scripts/android/mdm-headwind-client.mjs` provides an operator-only client for the
actual console API. Load its session with
`HeadwindLabClient.fromStorageState(origin, privateStorageStatePath)`. Configuration
updates require both a complete snapshot and its explicit expected ID. Device
override updates and notifications are separate actual API operations. Coordinate
all mutations with the device owner and the policy acceptance runner; restoring a
snapshot while another scenario is active invalidates its evidence.

Export private actual configuration/device observations and independently measured
installed-package metadata, then run:

```sh
node scripts/android/mdm-deployment-verify.mjs \
  --release <approved-tag> --mdm-origin http://127.0.0.1:18080 \
  --configuration /private/configuration.json --device /private/device.json \
  --installed /private/installed.json --not-before <deployment-start-epoch-ms> \
  --output /private/new-deployment-observations.json
```

The installed observation has `applicationId`, `versionCode`, `versionName`,
`certificateSha256`, `apkSha256`, `apkBytes`, `uid`, and `observedAt` (epoch milliseconds).
Use `adb shell pm path org.opentriage.android` to locate the installed base APK,
pull that exact file to private host storage, and measure its SHA-256 and byte
length. Inspect its signer with `apksigner verify --print-certs`. Reject split or
ambiguous package layouts for this single-APK release. Supply values measured on
the leased device, never copied from the expected release descriptor. Matching
version and signer alone cannot establish which APK was installed.
The verifier writes a new `0600` file, verifies real MDM download bytes, and emits
only non-secret target/inventory facts and a policy digest. Its
`verified-deployment-observations` status deliberately does not claim clinical
acceptance, policy delivery, retained-work upgrade or owner signoff. Compare
pre/post target snapshots with `retainedMdmUpgrade` from
`mdm-deployment-contract.mjs`; separately retain the actual device journey evidence.

Record exact server/agent/APK source/digests, device kind, target IDs, timings,
policy observations, recovery/revocation outcomes, source/APK immutability guards
and cleanup. Record owner-delegated automation explicitly and leave remaining
human or physical checks open. Never convert unavailable resources into a passing
acceptance checkbox.

Primary implementation references: the
[upstream agent inventory implementation](https://github.com/h-mdm/hmdm-android/blob/75eff13e7e3faf2fbe0c4d22f42d24da2a139f69/app/src/main/java/com/hmdm/launcher/util/DeviceInfoProvider.java)
and [Android managed configurations](https://developer.android.com/work/managed-configurations).

The installed-APK path parser accepts Android's normal `/data/app/~~…` layout
while rejecting ambiguous/split paths. Earlier failed operator attempts remain
archived as failures; the completed acceptance above used a fresh authorized
target without clearing or replacing an already enrolled target for preparation.

For this fresh delivered target, `runReportRecoveryJourney` accepts explicit
`targetPreparation: 'external'` together with `hooks.prepareTarget`, an awaited
function receiving the selected target and issued synthetic artifact. The hook
must prove freshness before proceeding, using independently verified installed
bytes plus the actual unpaired UI. A missing/invalid hook or rejected proof aborts;
default callers retain their original package clear. Never use this override to
resume an already enrolled or pending-work target through the preparation phase.

`ActualManagedUiObservationTest` is a vendor-neutral instrumentation observer for
actual externally delivered policy: `pairingConflict` imports a synthetic
conflicting artifact without confirming enrollment; `managedBlocked` verifies
fail-closed UI and exact sealed envelope preservation; `managedRestored` verifies
existing login and native credentials after restoring the original policy.
`deliveredPolicyFingerprint` reports only a typed policy digest. These methods
never deliver restrictions, clear data or sign in. Run methods individually with
their explicit fixture arguments and a separately recorded test APK identity.
Ready paired UI does not render the setup-only managed-origin notice, so restored
observation checks the native policy origin and absence of an editable URL.
Instrumenting a clinical app may perform ordinary startup network work; these
observations alone do not prove absence of HTTP traffic or revocation acceptance.
The completed acceptance above combined these observations with the real
clinical, policy, upgrade and server-authority journeys.

Native validation also checks actual instrumentation APK DEX class definitions
against its active Java source directories, including configured shared helpers
and variant-specific sources. A referenced descriptor alone is insufficient.
In this lab a release compile incorrectly remained up to date while omitting a
new tracked test, although the task's resolved source inputs included that file.
A task-scoped fresh `compileReleaseAndroidTestJavaWithJavac` run (up-to-date
predicate false and incremental compilation disabled for that task only) emitted
the missing class. Rebuild and verify the actual instrumentation APK after such
a retry; do not accept an old APK because compilation or signing exited zero.
Preserve the failed observation, identify the affected task inputs and outputs,
and avoid disabling incremental compilation across the whole project.

Observe persisted Android policy using `canonicalAndroidManagedPolicy` and
`androidManagedPolicyFingerprint` from `managed-policy-observation.mjs`. Keep the
configured Headwind payload unchanged. Android 13's restriction reader applies
Java `String.trim()` to scalar persisted text: only outer characters at or below
U+0020 are removed, with String/Integer/Boolean types retained. The helper models
that representation without changing internal PEM lines or certificate content.
It rejects unsupported values rather than coercing them. The existing native
JSONArray observer also escapes forward slashes; its typed sorted-row fingerprint
must use that encoding rather than ordinary Node JSON bytes. See Android's
[restriction reader](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-13.0.0_r63/services/core/java/com/android/server/pm/UserManagerService.java#5184)
and [JSONStringer string encoding](https://android.googlesource.com/platform/libcore/+/41407f7afb0a83dd4e71ff6e7a242923566ab7f3/json/src/main/java/org/json/JSONStringer.java#306).

The completed lab's typed observations matched Android's trimmed, slash-escaped
encoding without changing the configured policy. Earlier failed fingerprint
expectations remain archived separately from the completed clinical evidence.
Never make changed
certificate material or a String configuration version equivalent to the intended
Integer policy, and do not use this observer helper to change certificate trust.

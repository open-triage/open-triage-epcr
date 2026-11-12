# Android connection development

For Android Enterprise restrictions, policy transitions and vendor configuration
examples, see [managed connection configuration](android-managed-configuration.md).

Tickets 001–002 supply a development APK with the shared static web UI, import or
camera QR vehicle pairing and ordinary local sign-in. It uses Capacitor 8.6.0 and requires
Android 13 (API 33) or newer. This is a development identity
`org.opentriage.development`, signed with the developer's Android debug key;
it is not the production release/signing identity from ticket 013.

## Build and early checks

Install Node 22.12+, JDK 21, Android command-line tools, platform 36,
build-tools 36.0.0 and platform-tools. Set `JAVA_HOME` and `ANDROID_HOME`.
Accept Android's SDK licenses with `sdkmanager --licenses`.

```sh
npm ci
npm run android:build
```

The command builds the shared static export with generic server routing, copies
it into Capacitor, runs native unit tests and Android lint, and produces
`android/app/build/outputs/apk/debug/app-debug.apk` plus the instrumentation APK.
It strips public web routing/demo environment overrides for this build. Customer
origins and certificates are provisioned after installation, never compiled into
the APK. Do not distribute a development build as a supported signed release.

Run the existing application preflight and the Android journey before a PR:

```sh
npm run check:ci
npm run android:test
```

`android:test` requires Docker, OpenSSL and an already booted Android 13+ emulator.
For example, create an AVD from `system-images;android-33;google_apis;x86_64` and
start it with `emulator -avd <name> -no-snapshot -no-audio -gpu swiftshader_indirect`.
Wait for `adb shell getprop sys.boot_completed` to report `1`.
Set `ANDROID_SERIAL` when using a serial other than `emulator-5554`.
Hardware virtualization is strongly preferred; software emulation can take
several minutes to boot. Ports 9443 and 9444 must be free on the development host.

The harness creates a disposable PostgreSQL container and two independently
migrated installations, fictional administrators/clinicians and a short-lived
private test CA. It starts the real Nest APIs over HTTPS and installs the same
APK against each fixture. Instrumentation drives the shared file-input,
confirmation, local sign-in, assigned-calls and logout UI, then checks retained
pairing. It repeats the journey through the scanner plugin, using actual QR pixels
and the camera's QR-only decoder while substituting the camera frame result. This
also exercises the real Android camera permission denial, cancellation and retry.
The harness checks exactly one inventory addition per confirmed attempt and rejection of the consumed code, and
removes its container/fixtures afterward. It never reads `.env.local` or modifies
the developer's ordinary database/accounts. `--skip-build` reuses already built
artifacts for iteration. The Android GitHub workflow runs the same commands on
PRs to the feature branch and main.

## Manual import

1. Install the development APK with `adb install -r <apk>` or Android's installer.
2. In ordinary browser Admin, open the intended unit's Devices dialog and issue
   its five-minute pairing code.
3. Supply the installation's public CA certificates in PEM format when its HTTPS
   endpoint uses a private CA. Leave this field empty for platform-trusted HTTPS.
   Obtain the public certificates from the administrator's trusted IT channel;
   never copy private keys or accept an unverified first server connection.
4. Download the Android pairing file and transfer it through an approved channel.
   Import it inside the unconfigured APK before its five-minute expiry.
5. Review the server, organization and unit, enter an installation name and
   explicitly confirm. Sign in using an ordinary existing local account.

The JSON contract is version 1 with exactly `origin`, `token`, `expiresAt`,
`caPem` and `version`. Maximum encoded size is 64 KiB and CA text is at most
48,000 characters. Only HTTPS origins and public CA certificates are accepted.
The server remains authoritative for the existing five-minute, single-use code;
preview and download do not consume it. A failed preview does not change an
active connection. The first slice permits importing only into an unconfigured
APK; device reassignment is implemented in ticket 005.

## Camera pairing

After supplying public CA material in the unit's existing Devices dialog, choose
**Show Android pairing QR**. In a fresh APK, choose **Scan vehicle pairing QR**
and allow camera access. The decoded file enters the same destination preview and
explicit confirmation as import. The browser/PWA enrollment QR and link remain
available for their existing workflow; Android does not navigate to arbitrary
URLs found by its scanner.

Admin displays only the selected QR image. **Show Android pairing QR** replaces
the browser image; **Show browser/PWA QR** switches back, while the browser link
remains available. This prevents a camera from preferring an unrelated browser QR
in the same frame. A changed trust value or target invalidates pending image renders.

The QR contains the complete version-1 pairing JSON, including the public CA.
There is no unauthenticated bootstrap download. QR data is limited to 2,048 UTF-8
bytes, encoded at error correction M with a four-module quiet zone and a 512-pixel
source image. A representative RSA public-CA fixture is 1,340 bytes (QR version
30); the 2 KiB limit remains below QR 40-M byte capacity. Large chains remain
available through the 64 KiB import path. Admin rejects oversized QR generation
and clears any displayed QR when its CA text changes, so old trust material is
not silently reused. Keep the screen large enough and free from glare when
scanning; validate real print/screen/device conditions in the checklist below.

Camera frames are decoded in memory by pinned ZXing Android Embedded 4.3.0 with
ZXing core 3.5.4. Dense trust payloads can defeat finder search in one orientation;
the production decoder rotates actual cropped grayscale pixels through the four
orientations while retaining normal finder detection and error correction. Native
regressions cover independent payloads, all QR masks, practical image scales and
non-square YUV crops, so this category fails before emulator acceptance.
Scanning pauses when its activity pauses. Denial, cancellation, invalid
codes and unavailable cameras return to setup without consuming a code or changing
connection state. File import remains available when camera access is denied.

### Physical scanning checklist for ticket 019

Use synthetic accounts and record device, Android/WebView version, APK digest,
test environment, pass/fail and relevant non-secret evidence for each item.
Automated image/permission/plugin tests do not establish physical-camera acceptance.

- [ ] On the selected phone and tablet, install the same APK, display Admin's
  Android QR with a private-CA server and scan from another screen. Verify server,
  organization and unit in preview before explicitly naming/confirming enrollment.
- [ ] Repeat with a platform-trusted HTTPS server. Verify no Android Settings CA
  installation or server URL entry is needed for either path.
- [ ] Deny camera permission, retry, deny permanently, and revoke it in app
  settings. Verify localized states, usable file import and no enrollment side effect.
- [ ] Cancel with the scanner button and Android Back. Rotate, background/resume,
  and terminate/reopen the app before confirmation. Verify camera release and no
  inventory addition, lost authorization consumption or unintended confirmation.
- [ ] Scan then cancel preview and import the same still-valid file; repeat in
  the opposite order. Confirm once and verify exactly one new inventory entry.
- [ ] Exercise distant/close framing, phone/tablet orientation, enlarged text,
  glare, low light and a representative near-limit QR. Reject malformed,
  oversized, expired and consumed codes; keep import available for larger CA chains.
- [ ] Scan a browser enrollment QR, a different installation's code, and codes
  with an untrusted/expired/wrong-host TLS context. Verify rejection without
  redirecting credentials or changing active provisioning.
- [ ] Complete local sign-in, assigned calls and logout after pairing. Verify
  enrollment remains in inventory and clinician logout retains the device pairing.

## Connection and protection boundaries

The bundled UI stays at `https://localhost`; Capacitor serves packaged assets.
The Android startup gate mounts the shared application only after provisioned
connection state is ready. Service-worker installation and shell replacement are
disabled for this runtime. Browser routing and updates retain their existing path.

Same-origin `/api/` fetches cross a native plugin. The plugin owns a cookie jar
bound to the approved HTTPS origin and supplies that origin to the existing
server origin/agency checks. Normal CSRF and organization headers still apply.
It uses the platform hostname verifier and either platform trust or the supplied
CA roots, rejects redirects and restricts API paths and headers. Credentials
cannot be forwarded to a URL supplied by JavaScript. Session/installation cookies
are not returned to JavaScript or stored in localStorage; their vault uses
Android Keystore AES-GCM. Clinician logout clears the session cookie and retains
the installation cookie. Android backup and cleartext HTTP are disabled.

These slices validate pairing, scanning, protected work, managed settings and
local/OIDC authentication. See [Android authentication](android-authentication.md)
for the external-browser/native return strategy and independent browser CA
prerequisites. Generic API redirects remain rejected. Cross-agency handoff,
media, native downloads and comprehensive navigation have following tickets.
Emulator results do not substitute for the signing, actual MDM or physical-device
acceptance checkpoints in tickets 013 and 017–019.

## Protected work and foreground lifecycle

The native lifecycle adapter supplements WebView visibility. Assigned/open-report
refresh, report polling and queued text saves pause when the Activity pauses and
refresh or drain on resume. Already-started requests may settle; there is no
background service or promise of screen-locked synchronization. Shared browser
polling and authorization behavior remains in place.

Android uses the same Web Crypto, IndexedDB, Web Locks and storage-persistence
checks as the browser. Denied persistence is best-effort encrypted storage;
missing primitives are online-only, and an offline write failure pauses editing
without evicting pending ciphertext. No native report-key or plaintext report
store is introduced. The Android window uses `FLAG_SECURE` to exclude clinical
content from screenshots, screen recording and recents task snapshots. Application
backup and device-transfer exclusions remain enabled.

`npm run android:test` also seeds a published first-name form and real assigned
call using the committed catalog. The protected-work journey checks actual
Activity pause/resume, primitive and persistence fallback, radio disconnection,
reconnect synchronization, durable offline Save & close/reopen, write failure,
and host-issued `am force-stop` between phases. Offline relaunch exposes neither retained labels nor content. A second
clinician is denied the original recovery grant; the original clinician recovers
and synchronizes the encrypted pending edit online, retaining its original
report/form/catalog/validation pins. Restart, another clinician and authenticated
key restoration preserve the prior deadline; synchronizing the actual pending
edit follows the existing encrypted-write policy window and report expiry cap.
Unchanged browser recovery is separately checked to produce no new receipt or
deadline. API fixture startup
asserts that its explicit synthetic wrapping key is used, so a development fallback
cannot silently substitute for recovery configuration.

## Photo notes and binary media

Android uses the existing shared live-camera photo dialog, preview, rotation,
caption, timeline, thumbnails and full viewer. WebView camera requests use Android
runtime permission; denial keeps the localized recovery flow and text notes.
The pending permission request is serialized across the dialog’s transient
Activity pause/resume, so denial cannot automatically trigger another prompt.
Native Activity pause stops the live track, resume reacquires it, and late results
from a cancelled or paused capture cannot reopen the preview. Frames remain in
memory; previews and queued canonical photos use the existing encrypted protected
report store. No native camera file, gallery entry or backup copy is created.

The credentialed native connection carries request and response bytes as Base64
across the bridge, without decoding media as UTF-8. JSON and media share the same
origin, trust roots, cookie vault, managed-policy checks and redirect rejection.
Photo retrieval additionally rejects non-API and cross-origin locations in the
shared client and disables redirects in the browser. HEAD and 204/205/304 do not
buffer a body, even when representation Content-Length is present.

The current bridge caps decoded request and response wire bodies at 16 MiB to
bound simultaneous native/bridge/WebView copies. This supports the default 10 MiB
photo policy plus its JSON/Base64 command. Photo capture checks the encoded command
before staging an upload; a larger photo retains its encrypted preview and shows
localized retake guidance. A declared oversized response is rejected before its
body is read, and unknown-length bodies are bounded while reading. Future larger
media/download work must deliberately provide a bounded streaming path rather
than increasing this allocation ceiling without device acceptance.

Early `android:build` validation includes real TLS default-size binary round-trip,
invalid UTF-8 bytes, oversized response/request rejection and bodyless responses.
`android:test` captures a synthetic frame through the production shared camera
flow after actual permission denial/grant and Activity pause/resume, saves it
offline into encrypted report storage, then force-stops the live process. The
existing wrong-clinician and authorized recovery phases preserve ownership and
verify the recovered upload returns an exact hashed JPEG that decodes at its
expected dimensions. Physical image quality remains ticket 019 acceptance.

Automatic signing status, review-attention and EPS readers share the foreground
subscription with media draining. They start no new traffic during a paused
reconnect and refresh once per reader after resume without another connectivity
event. The early browser journey covers all three readers as well as delayed
permission denial and cancelled capture callbacks.

### Installation reassignment and interrupted confirmation

Use **Change installation** from the APK login or session controls to scan or
import another administrator-issued pairing artifact. Preview blocks old-context
requests and locks readable work. Cancel returns to the exact original connection
and its still-valid login; it cannot override changed or missing managed policy.
Confirm settles the shared encrypted-write boundary and signs out locally before
posting enrollment. Same-origin candidates carry installation authority only;
a different origin receives an empty cookie jar. The existing server registry
keeps the stable installation identity and immutable historical registrations for
same-server reassignment. No clinician cookie is copied to a candidate.

Before confirmation is sent, the native Keystore vault durably stores a random
256-bit attempt secret, the candidate connection and the exact request. These
values never enter WebView storage, pairing URLs or logs. If the response is lost
or the process dies, **Retry confirmed pairing** repeats that exact native request.
The server returns the same live registration and derived installation credential
for at most 15 minutes after its original commit. It does not renew that interval,
consume another code, rotate twice, create a personal session or revive a revoked
or replaced registration. The vault promotes the credential and removes its
journal in one encrypted commit. A definitive rejection of the first request clears its uncommitted journal so
a fresh pairing code can be imported. Unresolved or policy-conflicting journals keep
ordinary API calls blocked; contact the installation administrator if the retry
window has elapsed. Initial enrollment and ordinary browser enrollment retain
their existing authorization and expiry checks.

Each native bridge request includes an opaque runtime connection context that
changes on preview entry/cancel and promotion, including process restart. Old
queued requests and late responses cannot cross the binding change. Newly stored
protected ciphertext records also carry an opaque SHA-256 scope of their original server origin;
background recovery never advertises their handles to another server. Existing
unscoped ciphertext is retained. An authenticated legacy flat vault proves its
sole original server; its immutable opaque legacy scope is preserved atomically
through journal staging, promotion and future connection changes. Such records
are automatically offered only at that original server. Without that native
provenance, unscoped ciphertext is not automatically attributed to a new origin. An explicit report open can recover such a record only after an authorized
server grant and successful authenticated decryption. Recovery still requires the
original clinician's current valid login and the original recovery deadline.
Reassignment and revocation do not rewrite report ownership, pinned versions or
historical unit assignments.

`npm run android:test` includes the real protected-work reassignment scenario:
confirmed enrollment commits while the synthetic TLS fixture drops its response,
the host kills the live app process, the restarted app retries its encrypted
journal, and the inventory proves one rotation of the same installation identity.
It verifies the exact pending ciphertext survives, then revokes the pairing and
runs different-user denial and original-author recovery/synchronization. Synthetic
fault controls exist only in the test API launcher. `npm run check:ci` also covers
native preview/cancel, pending retry, origin-scoped handles and the existing
managed-policy and browser enrollment races.

## Production signing and upgrade checks

Production identity, custody, immutable artifact workflow and the real signed A/B
upgrade acceptance are documented in [Android releases](android-release.md).
Run `npm run android:validate:release` after `android:build` to catch release-only
build/signature regressions locally; the Android PR workflow runs this same early
check with a disposable key. Permanent-key distribution requires the separate
protected release workflow and actual signed upgrade evidence.


Android validation failures preserve bounded crash/runtime logs, application exit reasons, app memory and WebView version under `android/app/build/reports/android-failure/` before fixture/emulator teardown. These synthetic-emulator reports are included in the PR artifact for seven days. The collector excludes command arguments, screenshots, app files and bugreports; it redacts credential fields, known fixture secrets, URL queries, PEM blocks and long opaque values. Probe timeouts or collection failures never replace the original failing result, and instrumentation is never retried automatically.

Camera discovery records the active device without reopening its stream. Only an explicit camera cycle requests another device; duplicate native/document visibility notifications leave an already foregrounded stream running. Browser lifecycle coverage checks this before native acceptance.

The APK manifest removes only AndroidX EmojiCompat's automatic downloadable-font initializer; other local Startup components remain. Both debug and production builds check the actual merged manifests, and the native startup test verifies that this app initializer stays disabled. This does not prevent the OS-selected WebView from independently fetching provider fonts. See [Android's initializer configuration](https://developer.android.com/reference/androidx/emoji2/text/EmojiCompatInitializer).

The old Google-APIs emulator fixture ships WebView109, whose default font prefetch can bind the clinical process to Google Play Services' font provider. Captured `ApplicationExitInfo` and ActivityManager evidence showed Android killing that process when the provider died, even with the app initializer excluded. The default and signed-upgrade harnesses therefore scope a supported font profile to **isolated qemu userdebug/eng emulators with the evidenced WebView109**: only `PrefetchAndroidFonts` and `GMSCoreEmoji` are disabled; verbose logging proves the effective startup settings. Conflicting existing flags, physical/production Android images, symlinks and unsupported WebView generations fail before mutation. The original flag file's exact bytes, mode or absence are restored after success, clinical failure or setup failure; restoration failure fails acceptance. No APK production flags, TLS/origin checks, permissions, Google packages or clinical assertions change. The native probe checks actual provider acquisition and records the startup PID; the harness preserves effective flag evidence in `android/app/build/reports/android-font-profile/`.

This fixture control uses Chromium's [documented userdebug command line](https://github.com/chromium/chromium/blob/109.0.5414.74/android_webview/docs/commandline-flags.md) and the two entries in its [supported feature list](https://github.com/chromium/chromium/blob/109.0.5414.74/android_webview/java/src/org/chromium/android_webview/common/ProductionSupportedFlagList.java). It does not establish stock production WebView/GMS behavior: physical-device and regional-provider acceptance remains ticket019. Failed tests are never retried automatically. Failure artifacts also record provider exit reasons and package events so an external provider update/death is distinguishable from a Java assertion, app crash or emulator-host death.

## Android agency acceptance

The complete default `npm run android:test` journey includes the two-origin
agency handoff after ordinary protected-work and managed-configuration coverage,
before native OIDC. For focused diagnosis only, build the API and APK and run
`npm run android:test -- --skip-build --agency-only`. This does not replace the
complete default acceptance gate.

The fixture uses two real HTTPS API processes sharing one disposable database.
A registered `https://localhost` target is reached through a temporary ADB
reverse from device port 443 to the existing host fixture port 9444, with the
normal localhost certificate SAN and approved private CA. Packaged WebView
assets remain at the separate virtual `https://localhost` asset origin: Java
HTTPS requests reach the API, while WebView navigation reloads only bundled
assets. The original reverse map is captured and restored exactly. No new
container proxy, hostname verifier or trust bypass is installed.

The ordinary synthetic clinician creates genuine protected pending work before
logging out. A separately authenticated, already eligible installation superuser
cannot read that clinician's report, and performs the agency transition without
acquiring its author/unit/agency or original device credential. The test exercises
an untrusted target CA before source issuance, an actual live-process kill after
private preparation, cancellation preserving a still-valid source login, a
successful UI switch and bundled restart, explicit original pairing and original
clinician recovery at the fixed deadline, and managed-origin conflict before any
target request. A bounded fixture-only 503 response holds the synthetic report's
draft writes; all authentication, handoff and protected receipt/key requests use
the real API. This fixture behavior is absent from the production API entry point.

Native plugin responses and listener events use `LifecycleBoundPlugin`: settlement runs on the UI thread, checks the owning WebView at execution, and closes before worker cancellation when the Activity is destroyed. An ordinary pause keeps pending replies valid. This avoids Chromium109's `JsReplyProxy` worker-to-UI race, where destruction can clear the pointer between its initial check and deferred native call. Network authorization and durable pending-work outcomes keep their existing boundaries.

The early Android tests compile the actual reply gate and reproduce the original queue/pointer race before checking live and destroyed delivery. The current-APK startup instrumentation includes `NativeReplyLifecycleTest`: an instrumentation-only plugin registers on the real MainActivity before creation, holds success/error/events until after close, verifies callback disposal, and proves pause/resume and replacement-Activity live delivery. It adds no production bridge endpoint and does not alter immutable upgrade-candidate instrumentation.

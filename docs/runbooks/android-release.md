# Signed Android releases

New APK filenames use only the version name, for example
`opentriage-0.1.0-rc.6.apk`. The Android version code and SHA-256 stay in
`release.json`, with the digest also in `SHA256SUMS`. Existing published artifact
names and URLs remain immutable and supported by download validation.
Candidates 1–5 only recognize their original filename format in the installed
upgrade UI. Update those builds through browser Admin, the public release page,
MDM or ADB; the new build recognizes both filename formats.

The release owner delegated identity, custody and hosting selection on 2026-11-11
and authorized provisioning and candidate publication. The selected permanent
application is `org.opentriage.android`; the organization release maintainers for
`open-triage/open-triage-epcr` hold custody. The public certificate SHA-256 is:

```
2103f9a5fd4b17b113666165b86d52fad495d4e07b1507b18ee66a487a552a3a
```

The public record is [signing-identity.json](../releases/android/signing-identity.json).
The production key is RSA 4096/SHA256withRSA, generated for this identity with a
10,000-day validity. Development keeps `org.opentriage.development`, a debug key
and a separate Android data/Keystore namespace. Java class names remain stable;
the release application ID, resources and Capacitor metadata use the production
identity. The clinical app is an ordinary managed application.

## Custody and recovery

Encrypted GitHub Actions environment secrets in environment `android-release`
contain `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_CERTIFICATE_SHA256`.
The environment permits only `android-v*` tag deployments. No signing secrets
are available to the pull request workflow. GitHub Releases in this repository
is the authorized public artifact destination. Repository release immutability
is enabled: published assets and tags cannot be replaced.

The protected local backup is
`/home/eleph/.local/share/opentriage/android-signing`, directory mode `0700`,
files mode `0600`. It holds the password-protected `production.p12`, a separate
`credentials.json` and `RECOVERY.txt`. These files are outside the repository,
worktrees and release artifacts. Restrict their OS account to authorized release
maintainers. To recover, restore those protected files, export the public
certificate and compare its SHA-256 against the public record and prior APK,
then restore environment secrets through standard input to `gh secret set`.
Never print credentials, include them in shell arguments or regenerate a key for
an existing installation identity. Losing both backup and environment custody
prevents compatible upgrades. A second physical/off-machine backup and rotation
of maintainer access are operational custody tasks; this checkpoint records the
actual local backup and encrypted GitHub copy rather than inventing another copy.

## Build and verify

Follow [Android development](android-development.md) for SDK/emulator prerequisites.
Run these early before publication:

```sh
npm run check:ci
npm run android:build
npm run android:validate:release
```

The last command uses a disposable test key to catch production Gradle, release
lint, JVM, instrumentation build and APK-verification regressions on ordinary PRs.
It does not meet permanent-key release acceptance. Its APK must never be shipped.

For an authorized permanent-key build, load the protected inputs into process
environment without logging them or passing passwords as arguments. Set
`ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_CERTIFICATE_SHA256`, increasing
`ANDROID_VERSION_CODE` and semantic `ANDROID_VERSION_NAME`. Then run:

```sh
npm run android:release
```

`--native-only` reuses previously validated bundled assets.
`ANDROID_RELEASE_INSTRUMENTATION=1` additionally builds private local acceptance
instrumentation. Never publish that APK. `ANDROID_PREVIOUS_DESCRIPTOR` can point
to the prior `release.json`; the builder then checks identity, signing and version
progression. `ANDROID_RELEASE_OUTPUT` selects a new output directory; existing
output is rejected. Default output is ignored `.local/android-releases/<code>`.

The builder rejects missing signing inputs, unexpected permanent certificates,
invalid version codes/names, debuggable APKs, external shell URLs and cleartext.
The shared browser service worker and pairing/loading bootstrap are bundled;
clinical UI chunks are rejected. It verifies the actual package metadata and signature using
SDK tools. Each output contains a content-addressed APK, `SHA256SUMS` and
`release.json` recording identity, certificate, code/name, source commit, APK and
packaged-UI SHA-256, Android API range and client protocol versions. Customer
origins, public CAs and enrollment arrive after installation; customer server
configuration and TLS private keys are never compiled into the app. API compatibility uses the explicit inclusive protocol range in `compatibility.api`
(currently minimum 1 / maximum 1), independent of source provenance. The shared
contract exports the current protocol and range; `GET /api/health` advertises
`androidApiProtocol`. Compatible server commits retain protocol 1. Breaking
Android API changes require advancing the protocol and shipping a client whose
range includes it; test both boundaries before deployment. The actual upgrade
harness checks both APK descriptors against the fixture server's advertised
protocol, and publication requires that recorded protocol to be supported. Pairing artifact/protected schema/recovery-envelope
versions are explicitly recorded, and report/form/catalog/validation pins remain
part of existing protected storage.

## Upgrade acceptance and publication

Prepare release A and a higher-code release B using the same permanent key and
validated source. Build B with `ANDROID_RELEASE_INSTRUMENTATION=1`. With an
exclusive disposable Android 13+ emulator and free ports 9443/9444:

```sh
npm run build -w @open-triage/api
npm run android:test:upgrade -- /path/to/release-A /path/to/release-B
```

The harness requires a fresh isolated disposable emulator and rejects physical
devices or any existing production-package installation before changing fixture
state. It never uninstalls, clears, downgrades or copies an existing installation
to prepare A. Preserve that emulator and its data; provision a separate fresh AVD
when another clean baseline is needed. The real synthetic API/database and separate test DPC deliver a private CA,
managed server and ordinary enrollment. A clinician creates a durable encrypted
pending edit offline. After abrupt process termination the host installs B with
`adb install -r`, without clearing/uninstalling/copying data, and confirms ordinary
downgrade rejection. B verifies the original UID, Keystore-decryptable connection,
exact CA/enrollment, managed restrictions, presentation preference and exact
pending ciphertext; offline startup exposes no report content. A different
clinician cannot recover it; the original clinician recovers and syncs it online.
Report pins and recovery deadline rules are checked. A real remote HTML deployment
changes while A is running; reloading continues to show the packaged clinical UI
at `https://localhost` with no service worker in historical A. Current B uses
the shared browser service worker to adopt the paired server UI while retaining
that local origin and protected storage.
The historical A1 preparation profile is limited to its exact published descriptor,
APK digest, certificate, source, production package/version and preparation phase.
It creates the retained clinical text supported by that original source; A1
predates byte/photo transport and current lifecycle tests. The original text,
exact ciphertext, UID, pins, identity and recovery-deadline checks still run.
After those recovery assertions, signed B runs the full current photo capture,
pause, offline-byte and canonical-media checks. Default/current preparations keep
their full photo/lifecycle checks. A host-bound receipt records the exact A1
artifact and installed B version; no other source or version can select this
historical profile. Artifact/preflight source and test-harness source are recorded
separately, and any later harness delta must be explicitly allowlisted as test-only.

The result is `upgrade-evidence.json` beside B; failures never produce passing
evidence. Preserve failed-run logs and source/APK hashes before fixing or rerunning.
Fixtures and management owner are removed in cleanup.

A preflight evidence JSON records `status: passed`, `command: npm run check:ci`,
the exact tested `sourceCommit`, optional workflow run, and a `nativeAcceptance`
object with `status: passed`, `command: npm run android:test -- --skip-build` and
the same `sourceCommit`. Both full native acceptance and preflight must pass before
staging or publication. Publish only after all
checks using `scripts/android-release-publish.mjs <artifact-dir>
<upgrade-evidence.json> <preflight-evidence.json> <tag>`. Bootstrap candidates use
`android-candidate-<code>-<version>` tags. Publication re-verifies the APK,
permanent identity, evidence, preflight and increasing code against every Android
release; it fails if immutability is off or the tag exists. Only the clinical APK,
public descriptor, digest and non-secret acceptance/preflight evidence are uploaded.

After bootstrap, an authorized maintainer pushes
`android-v<code>-<semantic-version>` at the intended source. The release workflow
serializes candidate staging, runs the complete repository preflight and full
Android acceptance in parallel, restores signing
only in the protected environment, builds B and upgrades from the latest published
signed candidate A on an isolated emulator, then retains the exact production
APK and passing evidence as `android-verified-candidate`. Publish those exact
bytes locally with the existing owner credentials as described below. An older or duplicate code, missing prior candidate, secrets or
validation stops publication. Ordinary feature/PR pushes cannot publish releases.

An update preserves app data only when Android accepts the same application ID
and signing identity and a higher version code. Uninstalling, clearing app data,
changing application ID or factory-resetting removes enrollment and retained
protected work; encrypted data cannot be recovered by reinstalling a fresh app
without its original device data/Keystore state. Downgrades are unsupported.
The APK includes only a connection/pairing/loading bootstrap. Android and browsers use the same
[server UI update mechanism](android-ui-updates.md); a web deployment can update
the clinical UI without another APK. Native changes still require an APK upgrade.
Retain immutable APK descriptors for incident diagnosis. Candidate acceptance does not establish physical phone/tablet,
actual Intune/Headwind/MDMesh deployment or production rollout acceptance.

## Installation-approved downloads

See [Admin APK downloads](android-downloads.md) for explicit installation selection,
public hosting/MDM prerequisites, actual download verification and additive native
capability compatibility. Published candidate descriptors remain immutable.

## Publish staged candidates with owner credentials

The immutable-release settings endpoint requires repository Administration read
permission, which `GITHUB_TOKEN` cannot grant. Both normal tag builds and manual
recovery stage validated artifacts with the ordinary read-only token. Do not copy
a broad owner token into the runner.

To recover an earlier candidate whose publication failed, dispatch
`android-release.yml` from an `android-v*-recovery` controller tag with the unpublished tag
and the release run whose **preflight** and **acceptance** jobs passed. Controller tags use the reviewed
workflow on the feature branch; their push does not start a new release, and
they satisfy the protected environment’s existing tag rule. The workflow checks the exact
tag, source SHA, workflow, successful preflight and complete native acceptance, rebuilds from that clean
tag, repeats signed A/B acceptance, and retains only the production APK and
verification evidence as `android-verified-candidate`. It does not publish.

Download that artifact into a new directory, then use the existing owner CLI
credentials locally:

```sh
node scripts/android-release-publish.mjs /path/to/candidate \
  /path/to/candidate/upgrade-evidence.json \
  /path/to/candidate/preflight-evidence.json 'android-v<code>-<semantic-version>'
```

The publisher verifies the exact APK, signing identity, preflight and upgrade
evidence, checks live immutability settings and verifies the immutable result.
Never rebuild the APK between acceptance and publication.

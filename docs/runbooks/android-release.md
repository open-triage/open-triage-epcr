# Signed Android releases

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
invalid version codes/names, debuggable APKs, external shell URLs, cleartext and
service workers. It verifies the actual package metadata and signature using
SDK tools. Each output contains a content-addressed APK, `SHA256SUMS` and
`release.json` recording identity, certificate, code/name, source commit, APK and
packaged-UI SHA-256, Android API range and client protocol versions. Customer
origins, public CAs and enrollment arrive after installation; customer server
configuration and TLS private keys are never compiled into the app. Current API
compatibility is the recorded source revision; do not assume arbitrary server
versions are compatible. Pairing artifact/protected schema/recovery-envelope
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

The real synthetic API/database and separate test DPC deliver a private CA,
managed server and ordinary enrollment. A clinician creates a durable encrypted
pending edit offline. After abrupt process termination the host installs B with
`adb install -r`, without clearing/uninstalling/copying data, and confirms ordinary
downgrade rejection. B verifies the original UID, Keystore-decryptable connection,
exact CA/enrollment, managed restrictions, presentation preference and exact
pending ciphertext; offline startup exposes no report content. A different
clinician cannot recover it; the original clinician recovers and syncs it online.
Report pins and recovery deadline rules are checked. A real remote HTML deployment
changes while A is running; reloading continues to show the packaged clinical UI
at `https://localhost` with no service worker. B retains this packaged shell.
The result is `upgrade-evidence.json` beside B; failures never produce passing
evidence. Fixtures and management owner are removed in cleanup.

A preflight evidence JSON records `status: passed`, `command: npm run check:ci`,
the exact tested `sourceCommit` and optional workflow run. Publish only after all
checks using `scripts/android-release-publish.mjs <artifact-dir>
<upgrade-evidence.json> <preflight-evidence.json> <tag>`. Bootstrap candidates use
`android-candidate-<code>-<version>` tags. Publication re-verifies the APK,
permanent identity, evidence, preflight and increasing code against every Android
release; it fails if immutability is off or the tag exists. Only the clinical APK,
public descriptor, digest and non-secret acceptance/preflight evidence are uploaded.

After bootstrap, an authorized maintainer pushes
`android-v<code>-<semantic-version>` at the intended source. The release workflow
serializes publication, runs the complete repository preflight, restores signing
only in the protected environment, builds B and upgrades from the latest published
signed candidate A on an isolated emulator before publishing the immutable
prerelease. An older or duplicate code, missing prior candidate, secrets or
validation stops publication. Ordinary feature/PR pushes cannot publish releases.

An update preserves app data only when Android accepts the same application ID
and signing identity and a higher version code. Uninstalling, clearing app data,
changing application ID or factory-resetting removes enrollment and retained
protected work; encrypted data cannot be recovered by reinstalling a fresh app
without its original device data/Keystore state. Downgrades are unsupported.
The APK bundles its own UI bytes; a web deployment does not update them. Upgrade
APK and compatible API deliberately, and retain the old immutable descriptor for
incident diagnosis. Candidate acceptance does not establish physical phone/tablet,
actual Intune/Headwind/MDMesh deployment or production rollout acceptance.

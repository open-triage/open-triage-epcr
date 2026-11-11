# Approved Android downloads

Admin → Agency Settings contains a read-only Android application section.
The existing `settings:read` capability permits this section; `settings:write`
and another authentication prompt are not required. Every metadata read checks
the current session and capability, including verification-cache hits. Agency
selection does not change the APK.

## Installation selection

Set `ANDROID_APPROVED_RELEASE` in the API environment to a tag present in
`packages/contracts/config/android-releases.json`. With Helm, set
`api.androidApprovedRelease`. The default is empty: no APK is advertised until
the installation operator selects an approved release. For the published
bootstrap candidate:

```yaml
api:
  androidApprovedRelease: android-candidate-2-0.1.0-rc.2
```

This selects an existing signed release; it does not compile, sign, install or
roll out an APK. The catalog records the immutable descriptor, production
certificate digest and exact versioned GitHub URL. Catalog changes require normal
source review and release validation. Do not substitute a `latest` URL, learn
metadata from an arbitrary host, change the signing identity, or include private
signing material. See [the signing runbook](android-release.md).

The API verifies the descriptor, application/signing identity, base protocol and
required capabilities, then downloads the bounded APK and checks its byte length
and SHA-256 before advertising it. It follows only the exact approved GitHub
asset URL and public release-assets CDN redirects. It sends no application cookie
or authorization header to hosting. Successful verification is cached for
60 seconds; unsuccessful checks for five seconds. A missing selection,
unreviewed descriptor, unsupported contract, unavailable file or changed digest
produces an unavailable state with no usable download link. Refresh retries
verification; it changes neither approval nor compatibility policy.

The API needs outbound HTTPS access to `github.com` and
`release-assets.githubusercontent.com` and ordinary public CA trust. An egress
policy that blocks hosting causes the unavailable state. TLS verification remains
enabled.

## Administrator and MDM access

OpenTriage Admin access remains authenticated and authorized. The APK itself is
intentionally a **public immutable GitHub prerelease**, so its versioned URL is
usable directly by administrators and MDM catalogs without an OpenTriage cookie.
Knowledge of the URL grants no API, clinician or installation access. It is the
same digest and signing identity for every agency and installation selecting that
release. The APK contains no installation-specific credentials or private CA keys.

An administrator's browser must first trust the installation's HTTPS certificate
to reach Admin. Downloading from the public host uses that host's public CA trust,
independently of the app-specific CA supplied during pairing. Configure any MDM
download client and its network to reach the immutable hosting URL; never forward
an OpenTriage session cookie to the MDM or hosting provider.

Candidate 2 is the bootstrap artifact verified by ticket 013. Its Android 13
in-place upgrade evidence does not claim later OIDC/photo/audio features,
physical camera quality, actual Intune/Headwind/MDMesh enrollment, or production
rollout acceptance. Those remain the corresponding implementation and acceptance
tickets.

## Download and install verification

With the Android SDK and JDK configured, verify the actual hosted artifact:

```sh
npm run android:verify:download -- --release android-candidate-2-0.1.0-rc.2
```

The command follows the same bounded redirect and digest checks as the API, then
uses `aapt` and `apksigner` to check the downloaded package, version,
non-debuggable release flag and production signing certificate. Public evidence
is written under ignored `.local/android-download-validation/2/`. It never reads
the signing key and never downloads or publishes test instrumentation.

Only after reserving a disposable emulator, add the installation check:

```sh
npm run android:verify:download -- --release android-candidate-2-0.1.0-rc.2 \
  --install --serial 127.0.0.1:15563
```

This requires a booted emulator, installs the exact downloaded APK in place,
checks the installed application ID/version and force-stops it. It does not clear
app data, uninstall another release, reset a database, enroll a device or deploy
to a physical fleet. Installation and signature checks do not replace the
protected-work two-version acceptance in the signing runbook.

## Compatibility extensions

The source commit records provenance; it is not an API version. The explicit base
API range is checked against `androidApiProtocol`.
`compatibility.requiredCapabilities` is optional; absence means an empty list,
preserving the published candidate 1/2 descriptors. New native extensions such as
`native-enrollment-attempt-v1` and `native-oidc-return-v1` must be declared in the
server's `androidApiCapabilities` only with their deployed implementation, and in
future artifacts' required capabilities when used by those APKs. Missing health
capabilities mean an empty set. An unmet requirement is incompatible; upgrade
grace cannot make an unsupported protocol or capability work. Tickets 015/016
consume this same decision before applying grace policy.

The release builder and upgrade publication evidence preserve required
capabilities for future artifacts. Before adding a catalog entry, verify its real
descriptor, artifact, signature and upgrade acceptance against a server that
advertises all requirements. Never rewrite an immutable older descriptor to add
requirements retrospectively.

Installation-wide retirement and grace policy is managed separately in
[Android upgrades](android-upgrades.md). Agency download permission does not grant
that policy authority.

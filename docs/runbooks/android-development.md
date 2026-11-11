# Android connection development

For Android Enterprise restrictions, policy transitions and vendor configuration
examples, see [managed connection configuration](android-managed-configuration.md).

Ticket 001 supplies a development APK with the shared static web UI, import-based
vehicle pairing and ordinary local sign-in. It uses Capacitor 8.6.0 and requires
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
pairing. The harness checks inventory and rejection of the consumed code, and
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

This slice validates JSON/local-authentication traffic only. Camera scanning,
protected offline reports, managed configuration, OIDC, cross-agency handoff,
media, native downloads and comprehensive navigation each have following tickets.
Native redirects are rejected until an explicit supported return flow is added.
Emulator results do not substitute for the signing, actual MDM or physical-device
acceptance checkpoints in tickets 013 and 017–019.

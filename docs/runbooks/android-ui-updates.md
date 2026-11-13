# Shared browser and Android UI updates

Android fetches the clinical UI from the same enrolled HTTPS server that hosts
its web UI. It uses the browser's service worker, cache and update registration.
There is no separate update source, GitHub download, superadmin setting,
signing key or UI release channel to configure.

The native adapter maps only public UI documents, the service worker, manifest
and framework assets from `https://localhost` to the paired server. It verifies
that server with the existing approved CA and ordinary hostname verification.
It forwards no personal or installation cookies and accepts no redirects.
Clinical API requests continue through the existing authenticated native
transport and are never handled by the UI cache.

The local WebView origin remains `https://localhost`, preserving enrollment,
Keystore custody and protected browser storage. Capacitor injects its bridge at
document start, including cached documents. A WebView without document-start
injection stays on the local pairing/loading screen.

A normal web deployment publishes the UI and `/sw.js` together. The existing
`OPEN_TRIAGE_BUILD_SHA` changes the worker's version per deployment. Both browser
and Android clients check the shared worker on load and when returning online or
to the foreground. Android also checks when pairing establishes a server.
Local development uses this computer's paired HTTPS server in the same way.

A new worker precaches the shell and linked assets before activating. Failed
installations leave the previous worker in use. Reloads wait until the app is
visible and no clinical report or explicit-save editor is open. The previous
shell cache remains available for older asset requests from an open page.
Offline navigation uses the current worker's shell, rather than accidentally
selecting an older cached root document. API responses and clinical JSON are
never cached by this mechanism.

The APK bundles only a local connection/pairing/loading bootstrap and native
plugins. It does not contain clinical screens or Next.js clinical UI chunks.
First use requires a connection to download the server UI. After that, the
shared worker provides the cached UI offline. Upgrades from an older APK that
never cached a server UI also need one connected launch; existing encrypted
work and enrollment remain in the same local storage throughout. Native changes
still require an APK upgrade.

`npm run android:build` builds only the connection bootstrap. The Android test
harnesses build the hosted web export separately for the acceptance server.
The APK receives only the bootstrap from `apps/web/native-out`.
Build-time dependency checks reject clinical screens in the bootstrap. The
packaged-artifact check runs the actual file/scanner parsers and rejects bundled
Next.js chunks. Reusing an older full-UI bundle with `--native-only` is rejected.

Validation covers real worker installation, subsequent UI updates without a
manual reload, deferral during work, offline fallback and failed update checks
in both browser and Android modes. Native tests cover the HTTPS, credential,
redirect, path and MIME boundaries. The Android upgrade journey serves the real
web export and checks that adopting it retains the local storage origin.
Run `npm run check:ci` and the ordinary Android acceptance before publication.

After pairing or trust restoration, the loading screen verifies the server shell
and opens it even when the installed worker has not changed. Failed checks keep
the loading screen available for retry.

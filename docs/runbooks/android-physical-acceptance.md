# Physical Android workflow acceptance

This is the operator procedure and evidence record for [ticket 019](https://github.com/open-triage/open-triage-epcr/issues/817).
Complete it on an owner-selected physical Android 13+ phone **and** tablet using
the intended signed release and synthetic reports. Automated emulator evidence
supports Android 13 minimum coverage; it does not establish physical camera,
microphone, OEM/WebView, external identity-provider or fleet acceptance.

## Before the session

The IT/product owner supplies the representative models, an authorized test
installation and ordinary synthetic identities, including two distinct clinicians
and an administrator. For SSO deployments, supply the actual configured provider
and supported external browser. Do not record passwords, session cookies,
enrollment tokens, pairing QR images or private keys in the evidence.

Select the exact approved immutable release through [Admin downloads](android-downloads.md).
Verify its descriptor, downloaded bytes and production signature using that guide.
Pass the installation's current selected tag explicitly to the download verifier;
the guide's bootstrap candidate examples describe historical artifacts. Record
the Admin selection and verification time alongside the downloaded artifact.
Record the actual release and preflight/upgrade evidence; a source build, draft
release or historical candidate does not prove the selected release's behavior.
Use [signed release procedures](android-release.md) for verification and upgrade
constraints. Reserve an already accepted higher-version release for the physical
in-place upgrade; do not reuse a version code or generate a replacement signing key.

Use only authorized test devices. Record any pre-existing installation before
installing; preserve its data and Keystore. Never uninstall, clear app data or
factory-reset to obtain a passing upgrade. The automated emulator harness rejects
physical devices and must not be repurposed to drive this session. Collect device
details through normal Settings; optional owner-authorized ADB inspection must
target the selected serial explicitly and must not change device configuration.

For a private-CA deployment, obtain public CA certificates through the trusted IT
channel. Pairing supplies trust to the app without installing a CA in Android
Settings. Browser/Admin and OIDC trust are separate prerequisites described in
[Android authentication](android-authentication.md#external-browser-and-native-return)
and [TLS provisioning](android-tls-provisioning.md). Do not bypass TLS warnings.

Use the existing component procedures rather than a separate clinical workflow:

- [Pairing and physical scanner checklist](android-development.md#physical-scanning-checklist-for-ticket-019).
- [Protected work and foreground lifecycle](android-development.md#protected-work-and-foreground-lifecycle).
- [Photo notes](android-development.md#photo-notes-and-binary-media) and [audio notes](android-development.md#audio-notes).
- [Phone/tablet navigation checklist](android-development.md#shared-android-navigation-and-layout).
- [Authentication and agency handoff](android-authentication.md), [download permissions](android-downloads.md) and [upgrade policy](android-upgrades.md).

## Execute on each physical device

Record each step separately for the phone and tablet, including observed result,
UTC time, non-secret evidence reference and a defect link for any failure. Use
`pass`, `fail`, `blocked`, `not-run` or `not-applicable`. A not-applicable result
needs the deployment-specific reason and owner agreement; missing resources are
blocked, not not-applicable. An unexecuted row cannot be marked pass.

| ID | Action and required observation |
| --- | --- |
| P01 | Manually install the verified signed APK. Record installed package/version and confirm the expected release. On a device with an existing installation, preserve its data. |
| P02 | Generate a fresh combined vehicle/private-CA pairing in Admin, scan with the real camera, inspect destination and explicitly confirm. Repeat the import path on a separate authorized unconfigured test installation/device; do not reset enrolled data just to repeat setup. Verify exactly one inventory entry per confirmed enrollment and no Android Settings CA installation. Complete the linked scanner checklist, including denial/cancellation, orientation, realistic light/distance and invalid/expired/consumed codes. |
| P03 | Complete ordinary local login. Open and reopen an old permitted call, Save & close, recover eligible work and sign using the current valid login without another authentication prompt. Explicit logout/user switch and genuinely expired or revoked sessions must still enforce ordinary login and server authority. |
| P04 | When SSO is configured, use the deployment's actual provider in the supported external browser. Complete login/native return, cancellation, explicit user switch and interrupted return/relaunch. Confirm browser/private-CA trust independently. Record provider/browser/trust blockers; a synthetic provider result cannot replace this row. Reopening and signing under a valid OIDC login must not request repeated authentication. |
| P05 | Complete a representative fictional report through the shared Mobile and permitted Stationary/Review modes. Capture a real-camera photo, preview/rotate/caption it, save and view the authorized canonical image. Record actual image readability and any camera limitations. |
| P06 | Record an intelligible synthetic audio note using the physical microphone. Preview, cancel one recording, save another and play the authorized canonical audio through the intended output. Exercise permission denial and background interruption. Record microphone/speaker quality; emulator tones cannot establish it. |
| P07 | Follow the linked navigation checklist in portrait/landscape, the largest supported text setting, keyboard open/closed and the fleet's gesture/button navigation. Exercise Back during entry, recording, preview and saving; controls remain reachable and changes persist once. Cover intended languages and agency palette on both form factors. |
| P08 | Sign and inspect Review using ordinary current authority. Obtain permitted PDF/media downloads through the shared UI and verify the chosen destination and readable output. An unauthorized identity must not retrieve the same protected resource. Avoid retaining synthetic exports beyond the agreed test period. |
| P09 | Save eligible text/photo/audio while disconnected, close/reopen without killing the process, background/resume and restore connectivity. Verify encrypted pending durability, original pins/deadline and one acknowledged final revision/media result. No new background synchronization is promised. |
| P10 | Create durable eligible pending work, terminate the real app process and relaunch offline. No retained clinical labels/content may appear. Restore connectivity: the original currently authorized clinician can recover without repeated authentication, another clinician cannot, and report/form/catalog/validation pins and the original recovery deadline remain unchanged. Distinguish a process kill from Activity rotation or merely hiding the app. Record the actual termination method. |
| P11 | Exercise administrator revocation and reassignment with eligible pending work. Confirm current server authority controls subsequent access, old-user/origin work is not exposed to a new identity, and original ownership/pins/deadline remain intact. Restore only the intended test assignment. |
| P12 | With eligible encrypted pending work, install the verified higher-code same-identity/signer APK in place. Record A/B descriptors/digests and versions; retain device data, enrollment/CA and pending ciphertext. Offline restart stays locked; online original-author recovery preserves pins/deadline and synchronizes the pending value. A fresh install does not satisfy this row. |

Test privacy controls through ordinary observation: clinical content must not
appear in recents, screenshots or screen recordings. Do not disable the secure
window to collect evidence. Prefer synthetic identifiers, redacted server events,
hashes/version records and written observations; do not attach broad device logs,
bugreports or device storage dumps. Record defects rather than modifying the
device, trust or application to make a failing scenario pass.

## Evidence record

Copy this record into the authorized test evidence location for each execution.
Store only synthetic, non-secret evidence in GitHub. Keep sensitive deployment or
device inventory details in its approved restricted location and link an approved
redacted summary. The template itself is not a completed acceptance result.

```text
Ticket: #817
Session UTC / operator:
IT/product acceptance owner:
Environment identifier / API release or commit:
Server Android protocol / required capability verification:
Approved release tag / source commit / descriptor evidence:
Admin selected release / download verification UTC and evidence:
APK application ID / version name / version code / byte length / SHA-256:
Signing certificate SHA-256:
Exact release preflight / signed-upgrade evidence references:
Supporting Android 13 emulator evidence (source/APKs/environment/result):

Phone: manufacturer/model / Android version+API / build/security patch:
Tablet: manufacturer/model / Android version+API / build/security patch:
For EACH device: WebView package+version / browser package+version:
For EACH device: initial installed APK / target APK / physical device verified by:
For EACH device: locale / text scale / navigation / network conditions:
Installation trust: platform/private CA / approved certificate fingerprint reference:
Identity policy: local / actual OIDC provider and non-secret revision reference:
Synthetic identity labels and roles (no credentials):

Results (one row per device and test ID; expand linked component checklists):
Device | ID | UTC | result | observed behavior | evidence | defect/blocker
phone  | P01–P12, separately | | not-run | | |
tablet | P01–P12, separately | | not-run | | |

Upgrade on EACH device: A/B tag+code+SHA / same signer / in-place method:
Retained enrollment+CA / pending value and ciphertext digest / pins / original deadline:
Post-update offline denial / wrong-user denial / original-author online recovery:
Unresolved blockers / affected devices / defect links:
MDM evidence references (separate #815/#816; do not substitute for these results):
Cleanup and restored test settings / remaining synthetic exports:
Owner decision: pending / rejected / accepted
Owner name / UTC / agreed fleet and release scope / evidence reference:
```

Acceptance requires both physical-device records, all applicable results passing,
no unresolved blocking defects, supporting minimum-API automation and the named
owner's explicit decision for the recorded fleet/release scope. Leave ticket
019 open while physical hardware, actual configured SSO, required upgrade
artifacts or owner acceptance are missing. An MDM lab result or public draft PR
does not establish these outcomes. A defect fix or different APK requires
retesting affected rows against the exact replacement release.

## Preparation status

As of 2026-11-13, implementation dependencies are merged, but no owner-selected
physical phone/tablet or deployment SSO identities have been provided to the
dispatcher. Physical rows P01–P12 have not been executed and the rollout decision
is pending. A bounded read-only query of the existing local ADB server on
2026-11-12 at 19:50 UTC returned no attached devices; the workspace also exposed no USB bus.
This is an observation of this session, not evidence that the supported fleet
has no devices. No device was paired, installed, cleared or reconfigured.
This procedure records readiness only; it grants no physical-device
or production rollout acceptance. Populate the evidence record from actual
observations when the required resources and accepted release are available.

<!-- android-app:slice-019 -->

# [HITL] 019 - Accept the complete APK workflow on a physical phone and tablet

Status: Draft awaiting breakdown and publication approval.

Parent PRD: [Android application](parent.md#source-prd)

Source: [Android app PRD](../../prds/android-app.md)

Implementation branch: `feature/android_app`

Type: **HITL**

User stories covered: US-7, US-8, US-9, US-10, US-11, US-12, US-20, US-21, US-25, US-29, US-30, US-31, US-32, US-33, US-34, US-35, US-36, US-37, US-38, US-39, US-47, US-48.

## What to build

Complete the genuine physical-device acceptance checkpoint on representative Android 13+ phone and tablet hardware using the signed release. Exercise the full shared clinical experience, private-CA provisioning, real media hardware, authentication and interrupted-work recovery.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Human checkpoint

IT/product owners select and provide representative physical phone/tablet models and test identities, including the actual configured OIDC provider when that deployment uses SSO, and accept or reject the recorded outcomes.

## Acceptance criteria

- [ ] Record device model, Android/WebView versions, application/server release and tested environment. Cover the Android 13 minimum through emulator automation and the actual supported physical fleet.
- [ ] Manually install, scan/import the combined vehicle pairing, trust the internal CA without Android Settings, confirm enrollment and complete ordinary personal login. Validate real camera QR scanning.
- [ ] Exercise local authentication and the deployment's configured OIDC/fresh-proof/user-switch flows, including external browser/private-CA prerequisites. Record any provider or trust blocker explicitly.
- [ ] Complete a representative report with photo/audio notes, phone/tablet navigation, enlarged text, keyboard, Back and rotation, then signing, Review and authorized downloads using the shared UI.
- [ ] Exercise connection loss, background/resume, real process termination/relaunch, online recovery, revocation/reassignment and in-place update with eligible encrypted pending work. Do not claim background sync or offline restart recovery.
- [ ] Record pass/fail evidence and the human rollout decision using synthetic data only; link unresolved defects and prevent acceptance while blocking failures remain. MDM-specific proof is supplied separately by slices 017–018.

## Blocked by

- Blocked by `002-scan-vehicle-pairing.md`
- Blocked by `005-revoke-and-reassign.md`
- Blocked by `006-oidc-and-reauthentication.md`
- Blocked by `007-agency-handoff.md`
- Blocked by `010-stationary-review-downloads.md`
- Blocked by `011-navigation-and-layout.md`
- Blocked by `012-tls-provisioning-and-rotation.md`
- Blocked by `016-upgrade-gate-and-recovery.md`

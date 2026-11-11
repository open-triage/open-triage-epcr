<!-- android-app:slice-016 -->

# [AFK] 016 - Require upgrades before new work while preserving retained drafts

Status: Approved for implementation.

Parent PRD: [Android application](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Source: [Android app PRD](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-6, US-39, US-43, US-44, US-48.

## What to build

Apply the server's client-version policy to the Android clinical workflow and prove that an expired grace period directs the user to an update without erasing active or retained work.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] A supported current APK starts work normally; an approaching deadline produces the agreed localized notice; an expired/unsupported version is prevented from starting new work by an authoritative server decision as well as UI behavior.
- [ ] The notice identifies a compatible replacement from the installation's release metadata. Reinstalling, client clock changes and presentation-only state do not restart the retirement deadline; missing/invalid client metadata has an explicit server outcome. Version reporting is a compatibility mechanism, not a substitute for authorization or a claim of binary attestation.
- [ ] Version retirement alone does not discard current documentation, remove encrypted pending records or extend ordinary session/recovery authorization. Define the permitted transition from active work to update consistently with the PRD.
- [ ] A supported replacement installed in place recovers eligible old encrypted work online and synchronizes it under existing identity, expiry and late-work rules. Incompatible retained records remain explicit recovery material.
- [ ] Managed configuration, pairing and app-specific CA state survive the update; interrupted installation/relaunch and missing managed settings fail coherently.
- [ ] Two-version emulator journeys and supported-client contract tests exercise deadlines, active/offline pending work, interrupted upgrade, successful recovery and invalid/old formats. Retain checks for the oldest currently supported upgrade path.

## Blocked by

- Blocked by [#801](https://github.com/open-triage/open-triage-epcr/issues/801)
- Blocked by [#802](https://github.com/open-triage/open-triage-epcr/issues/802)
- Blocked by [#812](https://github.com/open-triage/open-triage-epcr/issues/812)
- Blocked by [#813](https://github.com/open-triage/open-triage-epcr/issues/813)

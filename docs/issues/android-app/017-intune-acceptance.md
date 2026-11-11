<!-- android-app:slice-017 -->

# [HITL] 017 - Accept installation, configuration and upgrades through Intune

Status: Approved for implementation.

Parent PRD: [Android application](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Source: [Android app PRD](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Implementation branch: `feature/android_app`

Type: **HITL**

User stories covered: US-2, US-22, US-23, US-24, US-25, US-39, US-45, US-46, US-47, US-48.

## What to build

With IT and a real Intune test tenant, deploy the signed APK to a fully managed or dedicated Android device, configure it through the standard interface, pair it to a vehicle and perform an upgrade while preserving configuration and pending work.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Human checkpoint

IT supplies access to an Intune test deployment, an enrolled Android 13+ device, suitable test identities and approved certificate/configuration profiles, and confirms the observed deployment outcome.

## Acceptance criteria

- [ ] Deploy the same signed artifact obtained through Admin using Intune's supported direct-APK route for the agreed fully managed/dedicated device scope.
- [ ] Deliver standard app configuration and the selected internal-CA trust mechanism; verify managed locking, matching pairing, rejected conflicting configuration, ordinary sign-in and foreground synchronization.
- [ ] Validate the actual tenant's configuration-policy targeting during APK upgrades, including Microsoft's documented direct-LOB policy reassignment requirement. Retained values must not silently become unmanaged during the transition.
- [ ] With encrypted pending work present, upgrade in place, relaunch and recover online. Verify inventory, pairing and applicable device/installation revocation behavior.
- [ ] Record non-secret environment/version facts, steps, evidence and human acceptance or explicit blockers. Add findings to reproducible operator instructions and upstream regression tests where automatable.
- [ ] Do not substitute Test DPC or an emulator for Intune acceptance, and do not add Intune MAM SDK or work-profile distribution to this slice.

## Blocked by

- Blocked by [#800](https://github.com/open-triage/open-triage-epcr/issues/800)
- Blocked by [#802](https://github.com/open-triage/open-triage-epcr/issues/802)
- Blocked by [#803](https://github.com/open-triage/open-triage-epcr/issues/803)
- Blocked by [#810](https://github.com/open-triage/open-triage-epcr/issues/810)
- Blocked by [#812](https://github.com/open-triage/open-triage-epcr/issues/812)
- Blocked by [#814](https://github.com/open-triage/open-triage-epcr/issues/814)

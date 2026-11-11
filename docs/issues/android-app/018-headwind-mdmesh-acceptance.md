<!-- android-app:slice-018 -->

# [HITL] 018 - Accept standard app management through combined Headwind/MDMesh

Status: Approved for implementation.

Parent PRD: [Android application](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Source: [Android app PRD](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Implementation branch: `feature/android_app`

Type: **HITL**

User stories covered: US-2, US-22, US-23, US-24, US-25, US-39, US-45, US-46, US-47, US-48.

## What to build

With the owner of the combined Headwind/MDMesh deployment, verify delivery of the generic APK and Android-standard settings, then pair, use and upgrade the application on a managed device. Identify missing MDM capabilities as external work rather than embedding vendor-specific behavior in OpenTriage.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Human checkpoint

IT supplies the combined repository/deployment identity, a compatible managed agent/device and authority to exercise a test configuration. Any missing standard restrictions or certificate-delivery support must be implemented and accepted in that separate MDM project.

## Acceptance criteria

- [ ] Inspect the actual combined system and record its server/agent versions and supported managed-configuration path; do not infer capabilities solely from upstream Headwind or MDMesh documentation.
- [ ] Import/deploy the Admin-provided APK and digest, deliver settings through Android's standard interface, enforce managed values and complete the existing vehicle-pairing flow against the intended internal-CA installation.
- [ ] Validate reconnect, managed setting updates/conflicts, missing configuration and an in-place application upgrade with retained enrollment and recoverable pending work.
- [ ] If the agent cannot deliver required standard restrictions, record the exact external blocker and link the separate project work once available. Do not implement that agent feature in this repository or declare managed provisioning complete through a manual workaround.
- [ ] Record actual deployment evidence and human acceptance with non-secret runbook steps. Feed reproducible app-side failures into regression checks.
- [ ] Use the same APK and app configuration contract as Intune; no vendor-specific clinical UI, device-owner role for OpenTriage, or copied private server keys.

## Blocked by

- Blocked by [#800](https://github.com/open-triage/open-triage-epcr/issues/800)
- Blocked by [#802](https://github.com/open-triage/open-triage-epcr/issues/802)
- Blocked by [#803](https://github.com/open-triage/open-triage-epcr/issues/803)
- Blocked by [#810](https://github.com/open-triage/open-triage-epcr/issues/810)
- Blocked by [#812](https://github.com/open-triage/open-triage-epcr/issues/812)
- Blocked by [#814](https://github.com/open-triage/open-triage-epcr/issues/814)

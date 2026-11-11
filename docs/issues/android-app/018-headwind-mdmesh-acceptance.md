<!-- android-app:slice-018 -->

# [HITL] 018 - Accept standard app management through combined Headwind/MDMesh

Status: Draft awaiting breakdown and publication approval.

Parent PRD: [Android application](parent.md#source-prd)

Source: [Android app PRD](../../prds/android-app.md)

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

- Blocked by `002-scan-vehicle-pairing.md`
- Blocked by `004-standard-managed-configuration.md`
- Blocked by `005-revoke-and-reassign.md`
- Blocked by `012-tls-provisioning-and-rotation.md`
- Blocked by `014-admin-apk-download.md`
- Blocked by `016-upgrade-gate-and-recovery.md`

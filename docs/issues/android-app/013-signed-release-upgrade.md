<!-- android-app:slice-013 -->

# [HITL] 013 - Establish the production signing identity and verify a signed APK upgrade

Status: Draft awaiting breakdown and publication approval.

Parent PRD: [Android application](parent.md#source-prd)

Source: [Android app PRD](../../prds/android-app.md)

Implementation branch: `feature/android_app`

Type: **HITL**

User stories covered: US-1, US-6, US-39, US-47, US-48.

## What to build

Turn the functioning application into a distributable release with its real application ID, signing ownership and protected release credentials. Produce two correctly signed versions and prove an in-place upgrade preserves enrollment and pending encrypted work. This is a genuine human checkpoint because the permanent identity and custody of signing material have not been selected.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Human checkpoint

The product/release owner selects the production application ID, signing-key owner and protected credential/backup location and provisions the release environment. Do not generate or publish a permanent identity on the owner's behalf without this decision.

## Acceptance criteria

- [ ] The release owner records the selected application ID, signing certificate fingerprint, signing custody/recovery process and authorized artifact destination without exposing private key material.
- [ ] Implement the repeatable release build/signing/verification workflow around those inputs; keep development signing isolated and fail release publication when required signing configuration or validation is missing.
- [ ] Every release has an increasing Android version code, immutable artifact/digest and a descriptor recording app identity, version and client/protocol compatibility. Do not embed customer server settings or TLS private keys.
- [ ] Verify install of release A and in-place upgrade to release B retain connection/CA configuration, unit enrollment, relevant presentation preferences and recoverable encrypted pending work.
- [ ] Application UI bytes stay tied to the installed APK even after a web deployment. Document supported upgrades and distinguish update from uninstall/data clearing/downgrade.
- [ ] Run applicable build, native/emulator, signature and upgrade checks plus the repository preflight before the real release is accepted. Record actual artifacts and evidence; test-key builds alone do not satisfy the human checkpoint.

## Blocked by

- Blocked by `003-offline-report-recovery.md`

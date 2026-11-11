<!-- android-app:slice-004 -->

# [AFK] 004 - Provision and lock server settings through standard Android management

Status: Draft awaiting breakdown and publication approval.

Parent PRD: [Android application](parent.md#source-prd)

Source: [Android app PRD](../../prds/android-app.md)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-2, US-22, US-23, US-24, US-25, US-45, US-46.

## What to build

Make the APK usable by any compatible Android MDM through a declared managed-configuration schema. Deliver the receiver, effective-configuration UI behavior, documented sample payloads and a standard test-controller demonstration, independent of vendor-specific production environments.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] Declare documented configuration keys/types for the connection and supported trust/provisioning options and read them through Android's standard managed-configuration interface on startup, resume and restriction changes.
- [ ] A standard management test controller supplies the same generic APK with a working server context. Pairing still supplies the existing unit authorization and does not confer clinician privileges.
- [ ] Managed connection values are visibly locked. Conflicting QR/import values fail before enrollment or credential transfer; valid matching pairing succeeds.
- [ ] Incomplete/invalid managed data and transient missing values do not silently convert an already managed connection into an editable or unrelated remembered connection. Define the effective-state transition contract for later reassignment and upgrade work.
- [ ] Public-CA and supported private-CA management configurations work without vendor-specific clinical UI or MDM SDK calls. Document the distinction between application-specific trust and any optional device CA-store trust.
- [ ] Native contract and emulator tests demonstrate provisioning, override rejection, live change/restart behavior and malformed/removed configuration. Include operator examples for Intune and the standard interface expected from combined Headwind/MDMesh, while reserving real vendor acceptance for slices 017–018.

## Blocked by

- Blocked by `001-import-pairing-and-sign-in.md`

<!-- android-app:slice-005 -->

# [AFK] 005 - Revoke or reassign Android installations without losing pending work

Status: Draft awaiting breakdown and publication approval.

Parent PRD: [Android application](parent.md#source-prd)

Source: [Android app PRD](../../prds/android-app.md)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-19, US-20, US-21, US-23, US-24, US-30, US-38.

## What to build

Complete the existing Admin inventory, revocation and vehicle reassignment lifecycle for the APK, including coordinated connection changes and preservation of eligible encrypted work from the old context.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] The APK appears in the existing unit inventory with its stable installation identity; no parallel Android fleet or vehicle registry is introduced.
- [ ] Admin revocation and inactive-unit/agency cases retain current server session and new-job restrictions. Clinician logout alone retains pairing; reassignment rotates credentials, preserves historical registration and requires fresh personal sign-in.
- [ ] A new confirmed pairing performs the existing lock/sign-out transition and coherent connection/trust/enrollment change. Failures and interrupted transitions never display a new unit while continuing to use another unit's credentials.
- [ ] Old-origin credentials, pending requests and local records are isolated from the new installation/agency. Eligible encrypted unsynchronized work remains available only through its original authorization and recovery deadline.
- [ ] Managed-value conflicts and managed server changes follow slice 004's authoritative configuration rules and cannot be bypassed by local re-pairing.
- [ ] API/database and Android journeys exercise revocation, same-server reassignment, changed-server intent, expired codes, interruption and retained pending work; browser enrollment/reassignment behavior remains covered.

## Blocked by

- Blocked by `003-offline-report-recovery.md`
- Blocked by `004-standard-managed-configuration.md`

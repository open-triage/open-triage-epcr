<!-- android-app:slice-003 -->

# [AFK] 003 - Document offline and recover work after Android process restart

Status: Draft awaiting breakdown and publication approval.

Parent PRD: [Android application](parent.md#source-prd)

Source: [Android app PRD](../../prds/android-app.md)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-29, US-33, US-34, US-35, US-36, US-37, US-38, US-48.

## What to build

Extend the paired local-sign-in APK through one real clinical text-documentation journey: open assigned work online, edit through connection loss, synchronize on return, terminate the process and recover retained work online as the authorized clinician. This completes the protected-work foundation of the PRD's first milestone.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] Opening an assignment remains online and idempotent; editing uses the shared report workflow and existing pinned form/revision contracts. Offline edits and reconnect synchronization preserve the established merge and late-work semantics.
- [ ] Web Crypto, IndexedDB, Web Locks and storage-persistence capability are checked in the Android runtime. Denied persistence, missing primitives and write failures produce the existing best-effort/online-only/read-only behavior without evicting unsynchronized work.
- [ ] After real emulator process termination and relaunch, no retained clinical labels, plaintext or keys are exposed offline. Authorized online recovery restores eligible pending edits; a different clinician cannot recover them.
- [ ] Logout, session expiry, access withdrawal and storage errors lock readable work using the existing lifecycle. Native diagnostics, temporary storage and Android backup introduce no plaintext clinical or authentication-credential copies.
- [ ] Assignment refresh and synchronization pause/resume with the foreground lifecycle. Reopening refreshes server state without promising screen-locked/background work or offline creation/recovery.
- [ ] The emulator test covers install/import/sign-in, open/edit, connection loss, reconnect, process kill/relaunch and online recovery against real services. Browser storage/recovery regressions remain covered and the journey runs in the early Android PR checks.

## Blocked by

- Blocked by `001-import-pairing-and-sign-in.md`

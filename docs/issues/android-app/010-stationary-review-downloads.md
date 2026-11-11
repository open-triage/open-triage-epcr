<!-- android-app:slice-010 -->

# [AFK] 010 - Sign, review and download reports through the shared Android UI

Status: Draft awaiting breakdown and publication approval.

Parent PRD: [Android application](parent.md#source-prd)

Source: [Android app PRD](../../prds/android-app.md)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-9, US-29, US-32.

## What to build

Complete the Android Stationary and Review paths through report validation/signing, media readiness, signed-record inspection and authorized downloads, using the same screens and permissions as the browser.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] Authorized users can open Stationary, satisfy existing signing checks and sign through the current online workflow; unresolved media, required reauthentication and clinical findings retain their existing behavior.
- [ ] Review and permitted Admin navigation remain available according to the same role model. A wrapper does not grant capabilities or expose reports excluded by server scope.
- [ ] Signed reports, photo/audio content and PDF/report downloads traverse the configured native connection with valid internal-CA trust and correct credentials.
- [ ] Native file viewing/download handoff preserves the repository's clinical-data handling, temporary-file cleanup and no-store boundaries. Unapproved external navigation cannot acquire application credentials.
- [ ] Emulator and existing API/browser tests prove signing, review scope, authorized download, denied download, media readiness and failure/retry. New text remains localized.

## Blocked by

- Blocked by `008-photo-notes.md`
- Blocked by `009-audio-notes.md`

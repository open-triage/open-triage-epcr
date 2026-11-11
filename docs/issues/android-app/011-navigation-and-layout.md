<!-- android-app:slice-011 -->

# [AFK] 011 - Preserve the shared workflow through Android navigation and layout changes

Status: Draft awaiting breakdown and publication approval.

Parent PRD: [Android application](parent.md#source-prd)

Source: [Android app PRD](../../prds/android-app.md)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-7, US-8, US-9, US-10, US-11, US-12, US-35, US-48.

## What to build

Make the existing clinical/Admin UI usable as an Android application on phone and tablet layouts, including Back, keyboard, safe-area, rotation and foreground transitions without introducing a visual or workflow fork.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] The first entry is Mobile and normal saved presentation preferences apply thereafter; role-permitted modes, agency appearance and supported languages stay consistent with the browser.
- [ ] Android Back, keyboard dismissal/resizing, safe areas, orientation changes and restored navigation do not silently discard or duplicate report changes or leave required controls inaccessible.
- [ ] Foreground entry refreshes assignments and pending sync using the shared lifecycle; bundled-UI versioning is not overridden by service-worker reloads.
- [ ] Apply the existing shared style guide and localization resources to required changes, preserving accessibility, text scaling, focus and phone/tablet layouts without unrelated redesign.
- [ ] Emulator navigation/resize/rotation and browser accessibility/localization tests exercise representative clinical and Admin paths. Supply reproducible physical checks for slice 019.

## Blocked by

- Blocked by `003-offline-report-recovery.md`

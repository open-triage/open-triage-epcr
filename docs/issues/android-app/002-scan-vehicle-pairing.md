<!-- android-app:slice-002 -->

# [AFK] 002 - Scan the existing vehicle-pairing QR in Android

Status: Approved for implementation.

Parent PRD: [Android application](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Source: [Android app PRD](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-13, US-15, US-16, US-17, US-18, US-25.

## What to build

Add camera scanning as another entry into the same provisioning and unit-enrollment journey delivered by slice 001. An installer obtains one code from Admin, scans it inside the APK, reviews the destination and confirms pairing; same-device import remains available.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] Admin's unit pairing action produces a QR representation compatible with the import contract. Scanning inside a fresh APK establishes the server/public CA context and reaches the same enrollment confirmation without URL entry or Android Settings.
- [ ] Retain browser/PWA enrollment behavior. A platform-specific launch mechanism must not consume the authorization before confirmation or send a code to an unrelated installation.
- [ ] The scanner handles camera permission denial, cancellation, retry, malformed codes and oversized trust material with localized actionable states. Validate a practical encoding/size limit; any separate bootstrap fetch is authenticated by information carried in the code.
- [ ] Expiry, replay, mismatched unit/agency and interrupted scans retain the single-use and coherent-configuration guarantees from slice 001. Import and scanning do not create different enrollment identities for the same confirmed attempt.
- [ ] Automated Android scanner/decoder and enrollment journeys cover success and failure, and an executable physical-scanning checklist is supplied for slice 019.

## Blocked by

- Blocked by [#799](https://github.com/open-triage/open-triage-epcr/issues/799)

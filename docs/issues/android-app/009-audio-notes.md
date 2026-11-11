<!-- android-app:slice-009 -->

# [AFK] 009 - Record and play audio notes over the configured Android connection

Status: Draft awaiting breakdown and publication approval.

Parent PRD: [Android application](parent.md#source-prd)

Source: [Android app PRD](../../prds/android-app.md)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-31, US-32, US-33, US-34, US-38.

## What to build

Deliver the existing audio-note recording, preview, protected staging, upload and playback workflow in the APK, including Android microphone permissions and lifecycle interruptions.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] A clinician can record, preview and save an audio note using the shared UI, then play the authorized note from its timeline or Stationary view.
- [ ] Microphone denial/revocation, unsupported recording, cancellation, backgrounding and process loss do not leave a hidden recorder running or claim an unsaved recording was retained.
- [ ] Use the existing protected offline/media-readiness and retry behavior. Avoid durable plaintext recordings, credential/clinical leakage in logs and unprotected backup copies.
- [ ] Authenticated upload and playback use the configured public/internal-CA trust and scoped credentials, including response streams/resource URLs and redirect failure paths.
- [ ] Emulator/native media fixtures and API/browser tests prove record-to-play, permission failures, offline staging and reconnection. Physical microphone and playback acceptance is retained for slice 019.

## Blocked by

- Blocked by `003-offline-report-recovery.md`

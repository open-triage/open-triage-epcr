<!-- android-app:slice-008 -->

# [AFK] 008 - Capture and view photo notes over the configured Android connection

Status: Approved for implementation.

Parent PRD: [Android application](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Source: [Android app PRD](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-31, US-32, US-33, US-34, US-38.

## What to build

Deliver the existing live photo-note journey in Android, including runtime permission, preview, protected offline staging, upload and later viewing over a public- or internal-CA connection.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] A clinician can capture, preview and save a photo through the existing shared note UI and find it in the timeline; no separate Android photo workflow is introduced.
- [ ] Camera permission granted/denied/revoked, unavailable capture, cancellation and process/lifecycle transitions produce the existing localized capability and recovery behavior.
- [ ] Offline staging and reconnect upload preserve current encryption, upload-readiness and clinical ownership rules. Temporary native data, backups and logs do not introduce durable plaintext clinical copies.
- [ ] Photo upload, authenticated retrieval, thumbnails and full viewing use the approved connection/trust context; redirect and cross-origin cases cannot leak credentials.
- [ ] Native/emulator capture fixtures and API/browser regressions cover capture-to-view, failure/retry and offline recovery; physical camera quality and device behavior are exercised in slice 019.

## Blocked by

- Blocked by [#801](https://github.com/open-triage/open-triage-epcr/issues/801)

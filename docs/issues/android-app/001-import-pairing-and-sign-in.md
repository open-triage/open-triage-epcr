<!-- android-app:slice-001 -->

# [AFK] 001 - Import vehicle pairing and sign in to the bundled Android app

Status: Draft awaiting breakdown and publication approval.

Parent PRD: [Android application](parent.md#source-prd)

Source: [Android app PRD](../../prds/android-app.md)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-1, US-3, US-7, US-8, US-13, US-14, US-16, US-17, US-18, US-19, US-25, US-26, US-28, US-29, US-49.

## What to build

Deliver the smallest usable Android connection journey: install a development APK containing the existing web build, import a pairing artifact issued from Admin for a unit, establish application-specific internal-CA trust, confirm enrollment, sign in with an existing local account and view the unit's assigned calls. This slice establishes the shared native connection/provisioning contract. Camera scanning, offline report recovery, media and OIDC follow in their own slices.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] A repeatable Android 13+ development build bundles the existing static web UI, opens initially in Mobile and can be installed without MDM. The UI works from bundled assets; web/service-worker deployments cannot silently replace it.
- [ ] An authorized administrator prepares the server/public CA information and issues a versioned, bounded importable artifact through the existing unit enrollment flow. It contains no server/private signing keys and preserves the existing five-minute single-use authorization.
- [ ] An unconfigured APK imports that artifact, authenticates the first HTTPS connection to an internal-CA server without Android Settings, previews the organization/unit, requires installation-name and explicit confirmation, and appears in the existing installation inventory.
- [ ] Malformed, oversized, expired, replayed or wrong-origin artifacts and invalid TLS chains/hostnames fail without partially changing the active connection or enrollment. Bootstrap does not obtain trust by accepting an unverified server.
- [ ] The native connection handles the existing session/installation credentials, agency binding and CSRF semantics. Local sign-in loads assigned calls; logout removes the clinician session while retaining unit pairing. No broad browser CORS/cookie protections are weakened.
- [ ] The same development artifact connects to two independent installation fixtures without rebuilding or mixing credentials. Development package/signing identities remain clearly separate from the production identity selected in slice 013.
- [ ] A runnable emulator journey with a real API and synthetic data proves import, internal-CA connection, confirmation, local login and logout; representative TLS/enrollment failures and the existing browser path remain covered. Add this narrow Android check to the documented local/PR validation path immediately.

## Blocked by

None - can start immediately

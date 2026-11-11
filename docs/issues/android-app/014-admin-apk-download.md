<!-- android-app:slice-014 -->

# [AFK] 014 - Download a compatible signed APK from Admin

Status: Draft awaiting breakdown and publication approval.

Parent PRD: [Android application](parent.md#source-prd)

Source: [Android app PRD](../../prds/android-app.md)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-1, US-4, US-5, US-6, US-9.

## What to build

Let an authorized administrator obtain the correct prebuilt Android release from the current installation, with enough metadata for direct installation or import into an MDM catalog.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] A compact localized Android application section in the existing Admin UI provides Download APK, release version, versioned URL and SHA-256 digest using shared components.
- [ ] The selected release is compatible with this server and its approved release metadata. An unavailable, unverified or incompatible artifact is not advertised as a usable global latest release.
- [ ] The download resolves to the same signed artifact for all agencies/installations using that release and preserves immutable version/digest identity. Downloading does not compile or sign per-customer builds.
- [ ] Reuse existing authorization for Admin access and keep policy mutation distinct from ordinary permitted download. Ensure artifact hosting is usable by the intended administrator/MDM and document private-CA/authentication prerequisites for obtaining the APK itself.
- [ ] Service/metadata, authorization and browser tests cover correct download, digest/version consistency, missing artifact, incompatible release and unauthorized access; verify the downloaded APK installs with the identity established in slice 013.

## Blocked by

- Blocked by `013-signed-release-upgrade.md`

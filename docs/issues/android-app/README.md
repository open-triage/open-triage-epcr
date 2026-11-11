# Android application issue hierarchy

Status: **Draft — awaiting breakdown and publication approval.** No GitHub issues have been created for this hierarchy.

Repository: [open-triage/open-triage-epcr](https://github.com/open-triage/open-triage-epcr).

Implementation branch: `feature/android_app`.

Source: [Android app PRD](../../prds/android-app.md), commit `4fb8d1b6`.

Parent body: [Complete PRD and hierarchy](parent.md).

The proposal contains **19 vertical slices: 15 AFK and 4 HITL**, covering all **49 PRD user stories**. Each implementation ticket owns its relevant behavior, failure cases and tests. HITL denotes an actual signing/provisioning decision or deployment/physical-device acceptance checkpoint; ordinary code review does not make a slice HITL.

## Proposed slices

1. **[[AFK] 001 - Import vehicle pairing and sign in to the bundled Android app](001-import-pairing-and-sign-in.md)** — AFK. Blocked by: none — ready. User stories: US-1, US-3, US-7, US-8, US-13, US-14, US-16, US-17, US-18, US-19, US-25, US-26, US-28, US-29, US-49.

2. **[[AFK] 002 - Scan the existing vehicle-pairing QR in Android](002-scan-vehicle-pairing.md)** — AFK. Blocked by: [001](001-import-pairing-and-sign-in.md). User stories: US-13, US-15, US-16, US-17, US-18, US-25.

3. **[[AFK] 003 - Document offline and recover work after Android process restart](003-offline-report-recovery.md)** — AFK. Blocked by: [001](001-import-pairing-and-sign-in.md). User stories: US-29, US-33, US-34, US-35, US-36, US-37, US-38, US-48.

4. **[[AFK] 004 - Provision and lock server settings through standard Android management](004-standard-managed-configuration.md)** — AFK. Blocked by: [001](001-import-pairing-and-sign-in.md). User stories: US-2, US-22, US-23, US-24, US-25, US-45, US-46.

5. **[[AFK] 005 - Revoke or reassign Android installations without losing pending work](005-revoke-and-reassign.md)** — AFK. Blocked by: [003](003-offline-report-recovery.md), [004](004-standard-managed-configuration.md). User stories: US-19, US-20, US-21, US-23, US-24, US-30, US-38.

6. **[[AFK] 006 - Complete OIDC sign-in and personal reauthentication in the APK](006-oidc-and-reauthentication.md)** — AFK. Blocked by: [003](003-offline-report-recovery.md). User stories: US-9, US-29, US-36, US-37, US-48.

7. **[[AFK] 007 - Switch authorized agencies without leaking Android session or draft state](007-agency-handoff.md)** — AFK. Blocked by: [005](005-revoke-and-reassign.md), [006](006-oidc-and-reauthentication.md). User stories: US-9, US-21, US-29, US-30.

8. **[[AFK] 008 - Capture and view photo notes over the configured Android connection](008-photo-notes.md)** — AFK. Blocked by: [003](003-offline-report-recovery.md). User stories: US-31, US-32, US-33, US-34, US-38.

9. **[[AFK] 009 - Record and play audio notes over the configured Android connection](009-audio-notes.md)** — AFK. Blocked by: [003](003-offline-report-recovery.md). User stories: US-31, US-32, US-33, US-34, US-38.

10. **[[AFK] 010 - Sign, review and download reports through the shared Android UI](010-stationary-review-downloads.md)** — AFK. Blocked by: [008](008-photo-notes.md), [009](009-audio-notes.md). User stories: US-9, US-29, US-32.

11. **[[AFK] 011 - Preserve the shared workflow through Android navigation and layout changes](011-navigation-and-layout.md)** — AFK. Blocked by: [003](003-offline-report-recovery.md). User stories: US-7, US-8, US-9, US-10, US-11, US-12, US-35, US-48.

12. **[[AFK] 012 - Provision server TLS and replace CA trust without rebuilding the APK](012-tls-provisioning-and-rotation.md)** — AFK. Blocked by: [001](001-import-pairing-and-sign-in.md), [004](004-standard-managed-configuration.md). User stories: US-25, US-26, US-27, US-28, US-45, US-48.

13. **[[HITL] 013 - Establish the production signing identity and verify a signed APK upgrade](013-signed-release-upgrade.md)** — HITL. Blocked by: [003](003-offline-report-recovery.md). User stories: US-1, US-6, US-39, US-47, US-48.

14. **[[AFK] 014 - Download a compatible signed APK from Admin](014-admin-apk-download.md)** — AFK. Blocked by: [013](013-signed-release-upgrade.md). User stories: US-1, US-4, US-5, US-6, US-9.

15. **[[AFK] 015 - Configure installation-wide APK upgrade grace in Super-admin](015-admin-upgrade-policy.md)** — AFK. Blocked by: [014](014-admin-apk-download.md). User stories: US-40, US-41, US-42.

16. **[[AFK] 016 - Require upgrades before new work while preserving retained drafts](016-upgrade-gate-and-recovery.md)** — AFK. Blocked by: [003](003-offline-report-recovery.md), [004](004-standard-managed-configuration.md), [014](014-admin-apk-download.md), [015](015-admin-upgrade-policy.md). User stories: US-6, US-39, US-43, US-44, US-48.

17. **[[HITL] 017 - Accept installation, configuration and upgrades through Intune](017-intune-acceptance.md)** — HITL. Blocked by: [002](002-scan-vehicle-pairing.md), [004](004-standard-managed-configuration.md), [005](005-revoke-and-reassign.md), [012](012-tls-provisioning-and-rotation.md), [014](014-admin-apk-download.md), [016](016-upgrade-gate-and-recovery.md). User stories: US-2, US-22, US-23, US-24, US-25, US-39, US-45, US-46, US-47, US-48.

18. **[[HITL] 018 - Accept standard app management through combined Headwind/MDMesh](018-headwind-mdmesh-acceptance.md)** — HITL. Blocked by: [002](002-scan-vehicle-pairing.md), [004](004-standard-managed-configuration.md), [005](005-revoke-and-reassign.md), [012](012-tls-provisioning-and-rotation.md), [014](014-admin-apk-download.md), [016](016-upgrade-gate-and-recovery.md). User stories: US-2, US-22, US-23, US-24, US-25, US-39, US-45, US-46, US-47, US-48.

19. **[[HITL] 019 - Accept the complete APK workflow on a physical phone and tablet](019-physical-workflow-acceptance.md)** — HITL. Blocked by: [002](002-scan-vehicle-pairing.md), [005](005-revoke-and-reassign.md), [006](006-oidc-and-reauthentication.md), [007](007-agency-handoff.md), [010](010-stationary-review-downloads.md), [011](011-navigation-and-layout.md), [012](012-tls-provisioning-and-rotation.md), [016](016-upgrade-gate-and-recovery.md). User stories: US-7, US-8, US-9, US-10, US-11, US-12, US-20, US-21, US-25, US-29, US-30, US-31, US-32, US-33, US-34, US-35, US-36, US-37, US-38, US-39, US-47, US-48.

## Dependency order

- Begin with **001**, the narrow bundled-APK/import/pairing/local-sign-in path to an internal-CA server. It intentionally excludes report work, camera scanning, OIDC and media.
- **002** (camera QR), **003** (protected offline work) and **004** (managed settings) can proceed after 001. Together, 001–003 deliver the PRD's initial complete manual-install/pair/document/restart/recover milestone.
- After 003, authentication, photo/audio, navigation and release-signing work can proceed independently. Reassignment also requires 004. CA provisioning/rotation requires 001 and 004.
- **007** joins reassignment and OIDC for agency handoff; **010** joins photo/audio for complete signing and report viewing/downloads.
- **013 → 014 → 015 → 016** delivers signed upgrades, Admin downloads, configurable grace and the new-work/update recovery behavior. 016 also reuses the protected-work path.
- **017**, **018** and **019** are separate acceptance tracks with only their actual implementation prerequisites. None claims another environment's results as its own; completion of the parent requires all three.
- Every declared dependency references an earlier-numbered ticket. `manifest.json` records the authoritative graph and story mapping.

## Human and external inputs

- 013: release application identity, signing-key ownership/custody and authorized artifact destination.
- 017: Intune test tenant, fully managed/dedicated Android device, test identities and approved configuration/certificate profiles.
- 018: actual combined Headwind/MDMesh repository/deployment and agent capabilities. Any missing standard managed-configuration support is separate work in that project, not new OpenTriage scope.
- 019: representative physical phone/tablet models, clinical tester/IT participation and the actual configured identity provider where SSO is used.

These inputs are called out in their tickets. Automated fixtures are sufficient for AFK implementation contracts but do not establish real signing custody, vendor integration or physical-device acceptance.

## Publication plan

1. Obtain approval of this concrete breakdown, dependencies, AFK/HITL choices and publication to **open-triage/open-triage-epcr**, as required by the invoked to-issues skill.
2. Inspect marker searches and the manifest before writing, and create one parent whose body contains the complete PRD.
3. Create children in dependency order, replace local blockers and parent references with real GitHub issue links, and attach every child with GitHub's actual sub-issue API.
4. Record IDs/URLs and verified relationship state in the manifest as each operation completes. Resume from missing operations after a partial failure instead of recreating issues.
5. Verify parent body, all child bodies, links and all 19 sub-issue relationships. Source-document links in GitHub bodies must use accessible URLs or the embedded parent PRD.

The GitHub connector supports issue creation but exposes no sub-issue mutation tool; the authenticated `gh api` path will attach children. A read of an existing repository hierarchy confirmed that the sub-issue endpoint is available. No publication or relationship writes have been attempted.

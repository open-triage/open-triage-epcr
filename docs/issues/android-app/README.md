# Android application issue hierarchy

Status: **Published.** Parent: [#798](https://github.com/open-triage/open-triage-epcr/issues/798). All 19 real sub-issue relationships verified.

Repository: [open-triage/open-triage-epcr](https://github.com/open-triage/open-triage-epcr).

Implementation branch: `feature/android_app`.

Source: [Android app PRD](../../prds/android-app.md), commit `4fb8d1b6`.

Parent body: [Complete PRD and hierarchy](parent.md).

The hierarchy contains **19 vertical slices: 15 AFK and 4 HITL**, covering all **49 PRD user stories**. Each implementation ticket owns its relevant behavior, failure cases and tests. HITL denotes an actual signing/provisioning decision or deployment/physical-device acceptance checkpoint; ordinary code review does not make a slice HITL.

## Published slices

1. **[[AFK] 001 - Import vehicle pairing and sign in to the bundled Android app](https://github.com/open-triage/open-triage-epcr/issues/799)** — AFK. Blocked by: none — ready. User stories: US-1, US-3, US-7, US-8, US-13, US-14, US-16, US-17, US-18, US-19, US-25, US-26, US-28, US-29, US-49.

2. **[[AFK] 002 - Scan the existing vehicle-pairing QR in Android](https://github.com/open-triage/open-triage-epcr/issues/800)** — AFK. Blocked by: [001](https://github.com/open-triage/open-triage-epcr/issues/799). User stories: US-13, US-15, US-16, US-17, US-18, US-25.

3. **[[AFK] 003 - Document offline and recover work after Android process restart](https://github.com/open-triage/open-triage-epcr/issues/801)** — AFK. Blocked by: [001](https://github.com/open-triage/open-triage-epcr/issues/799). User stories: US-29, US-33, US-34, US-35, US-36, US-37, US-38, US-48.

4. **[[AFK] 004 - Provision and lock server settings through standard Android management](https://github.com/open-triage/open-triage-epcr/issues/802)** — AFK. Blocked by: [001](https://github.com/open-triage/open-triage-epcr/issues/799). User stories: US-2, US-22, US-23, US-24, US-25, US-45, US-46.

5. **[[AFK] 005 - Revoke or reassign Android installations without losing pending work](https://github.com/open-triage/open-triage-epcr/issues/803)** — AFK. Blocked by: [003](https://github.com/open-triage/open-triage-epcr/issues/801), [004](https://github.com/open-triage/open-triage-epcr/issues/802). User stories: US-19, US-20, US-21, US-23, US-24, US-30, US-38.

6. **[[AFK] 006 - Complete OIDC sign-in and personal reauthentication in the APK](https://github.com/open-triage/open-triage-epcr/issues/804)** — AFK. Blocked by: [003](https://github.com/open-triage/open-triage-epcr/issues/801). User stories: US-9, US-29, US-36, US-37, US-48.

7. **[[AFK] 007 - Switch authorized agencies without leaking Android session or draft state](https://github.com/open-triage/open-triage-epcr/issues/805)** — AFK. Blocked by: [005](https://github.com/open-triage/open-triage-epcr/issues/803), [006](https://github.com/open-triage/open-triage-epcr/issues/804). User stories: US-9, US-21, US-29, US-30.

8. **[[AFK] 008 - Capture and view photo notes over the configured Android connection](https://github.com/open-triage/open-triage-epcr/issues/806)** — AFK. Blocked by: [003](https://github.com/open-triage/open-triage-epcr/issues/801). User stories: US-31, US-32, US-33, US-34, US-38.

9. **[[AFK] 009 - Record and play audio notes over the configured Android connection](https://github.com/open-triage/open-triage-epcr/issues/807)** — AFK. Blocked by: [003](https://github.com/open-triage/open-triage-epcr/issues/801). User stories: US-31, US-32, US-33, US-34, US-38.

10. **[[AFK] 010 - Sign, review and download reports through the shared Android UI](https://github.com/open-triage/open-triage-epcr/issues/808)** — AFK. Blocked by: [008](https://github.com/open-triage/open-triage-epcr/issues/806), [009](https://github.com/open-triage/open-triage-epcr/issues/807). User stories: US-9, US-29, US-32.

11. **[[AFK] 011 - Preserve the shared workflow through Android navigation and layout changes](https://github.com/open-triage/open-triage-epcr/issues/809)** — AFK. Blocked by: [003](https://github.com/open-triage/open-triage-epcr/issues/801). User stories: US-7, US-8, US-9, US-10, US-11, US-12, US-35, US-48.

12. **[[AFK] 012 - Provision server TLS and replace CA trust without rebuilding the APK](https://github.com/open-triage/open-triage-epcr/issues/810)** — AFK. Blocked by: [001](https://github.com/open-triage/open-triage-epcr/issues/799), [004](https://github.com/open-triage/open-triage-epcr/issues/802). User stories: US-25, US-26, US-27, US-28, US-45, US-48.

13. **[[HITL] 013 - Establish the production signing identity and verify a signed APK upgrade](https://github.com/open-triage/open-triage-epcr/issues/811)** — HITL. Blocked by: [003](https://github.com/open-triage/open-triage-epcr/issues/801). User stories: US-1, US-6, US-39, US-47, US-48.

14. **[[AFK] 014 - Download a compatible signed APK from Admin](https://github.com/open-triage/open-triage-epcr/issues/812)** — AFK. Blocked by: [013](https://github.com/open-triage/open-triage-epcr/issues/811). User stories: US-1, US-4, US-5, US-6, US-9.

15. **[[AFK] 015 - Configure installation-wide APK upgrade grace in Super-admin](https://github.com/open-triage/open-triage-epcr/issues/813)** — AFK. Blocked by: [014](https://github.com/open-triage/open-triage-epcr/issues/812). User stories: US-40, US-41, US-42.

16. **[[AFK] 016 - Require upgrades before new work while preserving retained drafts](https://github.com/open-triage/open-triage-epcr/issues/814)** — AFK. Blocked by: [003](https://github.com/open-triage/open-triage-epcr/issues/801), [004](https://github.com/open-triage/open-triage-epcr/issues/802), [014](https://github.com/open-triage/open-triage-epcr/issues/812), [015](https://github.com/open-triage/open-triage-epcr/issues/813). User stories: US-6, US-39, US-43, US-44, US-48.

17. **[[HITL] 017 - Accept installation, configuration and upgrades through Intune](https://github.com/open-triage/open-triage-epcr/issues/815)** — HITL. Blocked by: [002](https://github.com/open-triage/open-triage-epcr/issues/800), [004](https://github.com/open-triage/open-triage-epcr/issues/802), [005](https://github.com/open-triage/open-triage-epcr/issues/803), [012](https://github.com/open-triage/open-triage-epcr/issues/810), [014](https://github.com/open-triage/open-triage-epcr/issues/812), [016](https://github.com/open-triage/open-triage-epcr/issues/814). User stories: US-2, US-22, US-23, US-24, US-25, US-39, US-45, US-46, US-47, US-48.

18. **[[HITL] 018 - Accept standard app management through combined Headwind/MDMesh](https://github.com/open-triage/open-triage-epcr/issues/816)** — HITL. Blocked by: [002](https://github.com/open-triage/open-triage-epcr/issues/800), [004](https://github.com/open-triage/open-triage-epcr/issues/802), [005](https://github.com/open-triage/open-triage-epcr/issues/803), [012](https://github.com/open-triage/open-triage-epcr/issues/810), [014](https://github.com/open-triage/open-triage-epcr/issues/812), [016](https://github.com/open-triage/open-triage-epcr/issues/814). User stories: US-2, US-22, US-23, US-24, US-25, US-39, US-45, US-46, US-47, US-48.

19. **[[HITL] 019 - Accept the complete APK workflow on a physical phone and tablet](https://github.com/open-triage/open-triage-epcr/issues/817)** — HITL. Blocked by: [002](https://github.com/open-triage/open-triage-epcr/issues/800), [005](https://github.com/open-triage/open-triage-epcr/issues/803), [006](https://github.com/open-triage/open-triage-epcr/issues/804), [007](https://github.com/open-triage/open-triage-epcr/issues/805), [010](https://github.com/open-triage/open-triage-epcr/issues/808), [011](https://github.com/open-triage/open-triage-epcr/issues/809), [012](https://github.com/open-triage/open-triage-epcr/issues/810), [016](https://github.com/open-triage/open-triage-epcr/issues/814). User stories: US-7, US-8, US-9, US-10, US-11, US-12, US-20, US-21, US-25, US-29, US-30, US-31, US-32, US-33, US-34, US-35, US-36, US-37, US-38, US-39, US-47, US-48.

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

## Publication record

Approved by the product owner and published on 11 November 2026 using the to-issues skill. The GitHub integration created the parent and children; the GitHub REST sub-issue API attached all 19 children. Blocker links preserve the approved dependency graph. The manifest records remote IDs, URLs and verified attachment state.

<!-- android-app:slice-015 -->

# [AFK] 015 - Configure installation-wide APK upgrade grace in Super-admin

Status: Approved for implementation.

Parent PRD: [Android application](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Source: [Android app PRD](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-40, US-41, US-42.

## What to build

Provide the persisted installation-wide compatibility policy and its Super-admin UI, defaulting to 90 days and showing an effective rollout deadline based on actual server-supported APK versions.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] Super-admin can view and save the installation policy with a 90-day default; agency-only administrators cannot mutate it, and all agencies receive the same authoritative policy.
- [ ] Policy persistence and server validation operate alongside the release/compatibility descriptor from slice 014. Extending grace cannot declare an unsupported client/protocol/storage format compatible.
- [ ] Define documented allowed values and effective-time behavior within the existing PRD bounds. Show impact and effective deadlines before committing a policy change; use the repository's administration/audit conventions.
- [ ] Deadline calculation uses explicit retirement/supersession metadata with a compatible replacement available. Old-APK reinstall, client clock changes and unrelated server redeploys do not reset the deadline.
- [ ] The authorized client-facing policy response distinguishes compatible, approaching-upgrade and upgrade-required outcomes for slice 016 without exposing privileged administration data.
- [ ] API/database authorization and policy tests plus a localized browser UI journey prove default, edit, validation failure, persistence, cross-agency consistency and stable deadline behavior. Follow database authoring skills for any required migrations.

## Blocked by

- Blocked by [#812](https://github.com/open-triage/open-triage-epcr/issues/812)

<!-- android-app:slice-007 -->

# [AFK] 007 - Switch authorized agencies without leaking Android session or draft state

Status: Approved for implementation.

Parent PRD: [Android application](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Source: [Android app PRD](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-9, US-21, US-29, US-30.

## What to build

Carry the existing authorized agency-switch/handoff workflow through the bundled APK and its native connection. An eligible user changes agency context while preserving the shared authorization and protected-state boundaries.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] Only users allowed by the existing server handoff policy can switch; local and OIDC-issued sessions keep the same eligibility rules.
- [ ] Approved cross-host handoffs remain inside a validated Android return/connection flow instead of replacing the bundled UI with an arbitrary hosted page.
- [ ] Changing agency locks previous readable work and isolates cookies, CSRF values, installation identity and pending requests. Old reports retain their original author, unit and agency.
- [ ] Unexpected hosts, tampered/replayed handoff transactions, denied access, managed-context conflicts and interrupted handoffs fail without transferring credentials or mislabeling the active agency.
- [ ] Emulator plus existing handoff/agency-header integration coverage demonstrates permitted and forbidden transitions, including pending protected work and browser parity.

## Blocked by

- Blocked by [#803](https://github.com/open-triage/open-triage-epcr/issues/803)
- Blocked by [#804](https://github.com/open-triage/open-triage-epcr/issues/804)

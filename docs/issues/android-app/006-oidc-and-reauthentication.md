<!-- android-app:slice-006 -->

# [AFK] 006 - Complete OIDC sign-in and personal reauthentication in the APK

Status: Approved for implementation.

> **Owner decision — 2026-11-11:** Remove all repeated reauthentication and
> identity-confirmation prompts. A valid current login is sufficient for
> authorized actions and protected-work recovery. Keep initial login, explicit
> user switching, session expiry/revocation, ordinary authorization, ownership and
> recovery deadlines. This supersedes the historical reauthentication wording in
> this ticket's stable title and the parent user stories.

Parent PRD: [Android application](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Source: [Android app PRD](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-9, US-29, US-36, US-37, US-48.

## What to build

Complete configured OIDC and local sign-in through the Android connection boundary, including controlled browser/provider transitions, application return, explicit shared-device user switching and protected-work recovery using the valid current login. Do not add password/OIDC step-up, fresh-proof, shift reauthentication or repeated identity-confirmation prompts.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] A controlled provider completes ordinary login, unknown-identity handling, approved-user login and explicit user switching and returns to the intended APK/session. Local login and installation-owner/superadmin recovery remain available according to existing policy.
- [ ] Callback/return handling binds the intended transaction, user, installation and approved server context; forged/replayed/cancelled returns and unapproved redirects cannot issue an application session.
- [ ] Provider tokens and protected session credentials do not enter JavaScript-readable persistent setup. Preserve CSRF, expiry, revocation and current authorization. A valid current login remains sufficient even after five minutes and for reopening older calls; no fresh-proof, shift/new-job reauthentication or repeated confirmation is required.
- [ ] Authorized protected-work recovery and other actions use the current valid login without repeated password/OIDC prompts. Expired/revoked sessions, wrong users, withdrawn capabilities and expired recovery envelopes remain denied.
- [ ] Cached-provider user switching, logout, provider outage and process interruption preserve encrypted-work isolation and authorized recovery.
- [ ] Choose and document a provider-supported native return strategy. Test the OpenTriage internal-CA leg and explicitly identify any external browser/private-CA identity-provider prerequisites; do not bypass TLS or assume app-local trust configures external apps.
- [ ] Controlled TLS-provider, service and emulator tests cover the complete authentication/recovery paths alongside browser regressions. Real regional identity-provider acceptance remains an explicit environment checkpoint in slice 019.

## Blocked by

- Blocked by [#801](https://github.com/open-triage/open-triage-epcr/issues/801)

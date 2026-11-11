<!-- android-app:slice-006 -->

# [AFK] 006 - Complete OIDC sign-in and personal reauthentication in the APK

Status: Draft awaiting breakdown and publication approval.

Parent PRD: [Android application](parent.md#source-prd)

Source: [Android app PRD](../../prds/android-app.md)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-9, US-29, US-36, US-37, US-48.

## What to build

Preserve the existing configured OIDC and local authentication behavior through the Android connection boundary, including controlled browser/provider transitions, application return, personal reauthentication, shared-device user switching and protected-work recovery.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] A controlled provider completes ordinary login, unknown-identity handling, approved-user login and personal reauthentication and returns to the intended APK/session. Local login and installation-owner/superadmin recovery remain available according to existing policy.
- [ ] Callback/return handling binds the intended transaction, user, installation and approved server context; forged/replayed/cancelled returns and unapproved redirects cannot issue an application session.
- [ ] Provider tokens and protected session credentials do not enter JavaScript-readable persistent setup. Preserve current CSRF, expiry, revocation, fresh-proof and shift/new-job requirements rather than substituting a browser prompt for personal proof.
- [ ] Cached-provider user switching, logout, provider outage and process interruption preserve encrypted-work isolation and authorized recovery.
- [ ] Choose and document a provider-supported native return strategy. Test the OpenTriage internal-CA leg and explicitly identify any external browser/private-CA identity-provider prerequisites; do not bypass TLS or assume app-local trust configures external apps.
- [ ] Controlled TLS-provider, service and emulator tests cover the complete authentication/recovery paths alongside browser regressions. Real regional identity-provider acceptance remains an explicit environment checkpoint in slice 019.

## Blocked by

- Blocked by `003-offline-report-recovery.md`

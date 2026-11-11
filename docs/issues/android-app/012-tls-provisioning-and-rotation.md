<!-- android-app:slice-012 -->

# [AFK] 012 - Provision server TLS and replace CA trust without rebuilding the APK

Status: Approved for implementation.

Parent PRD: [Android application](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Source: [Android app PRD](https://github.com/open-triage/open-triage-epcr/issues/798#source-prd)

Implementation branch: `feature/android_app`

Type: **AFK**

User stories covered: US-25, US-26, US-27, US-28, US-45, US-48.

## What to build

Complete the operator journey for IT-delivered TLS certificate/key material and deliberate public-CA-trust replacement. Exercise it against the same generic APK through pairing and managed configuration, including recovery when the previous trust is no longer valid.

Follow the parent PRD and repository instructions. Implement the complete behavior through every applicable layer, including persistence/contracts, native/API integration, shared localized UI and behavioral tests. Reuse the existing clinical, identity and protected-storage boundaries. Apply relevant database/Supabase skills before changing those areas. Run focused checks and `npm run check:ci` with its documented prerequisites before implementation PR publication; include this slice's native/emulator checks in the documented early validation path. Issue publication itself is not implementation or device acceptance.

## Acceptance criteria

- [ ] A documented shell workflow installs the server's certificate chain/private key using the existing deployment secret mechanism and supplies the appropriate public CA information to Admin pairing. Keys are not exposed through Admin, provisioning artifacts, command logs or APKs.
- [ ] Operator validation covers certificate/key consistency, hostname/chain suitability and a successful application connection without disabling TLS verification.
- [ ] Ordinary server-certificate renewal under the trusted CA and deliberate CA replacement are demonstrated without customer-specific builds. Define and test overlap and explicit re-pairing/import recovery behavior.
- [ ] A failing connection never learns a new CA from an unauthenticated response; expired/untrusted/incorrect-host connections display actionable localized failures and preserve pending local work.
- [ ] Managed and manual trust changes respect configuration precedence and server isolation. Document the scope of optional device-store CA trust and the limits of application-only trust for external identity providers.
- [ ] Automated TLS fixtures and deployment/provisioning checks cover renewal, replacement, interrupted changes and invalid key/chain inputs; provide a runbook usable for the later MDM and physical checkpoints.

## Blocked by

- Blocked by [#799](https://github.com/open-triage/open-triage-epcr/issues/799)
- Blocked by [#802](https://github.com/open-triage/open-triage-epcr/issues/802)

# Prepare and enable the authentication, unit and shift workflow

An upgrade applies forward domain migrations without recreating application
users, report authors, units, audit actors, local credentials or recovery grants.
Never reset the demonstration account or bootstrap new identities as an upgrade
procedure. Back up and verify recovery using the existing database operations
and protected-storage runbooks before applying migrations.

Before migration, run the read-only inventory against the installation database:

```sh
npm run preflight:authentication -w @open-triage/database
```

Supply the operator `DATABASE_URL` in the process environment. The command uses a
read-only transaction, prints all conflicting group members and their original
values, and exits 2 when an explicit policy decision is required. Follow
[group policy preparation](group-authentication-policy.md), record the approving
administrator and chosen values, align only those immutable agency IDs, then
rerun the preflight. The existing group-policy migration also rejects conflicts;
this inventory does not bypass it or pick a weaker/stronger policy automatically.
After migration, effective policy is managed in Admin, rather than old columns.

All existing and newly created groups start in **preparation**. Local login and
existing clinician/unit assignment authority continue. Standalone production
reports keep their existing clinical permission checks. Synthetic identities
remain confined to synthetic work. Session expiry, access withdrawal and any
already-associated device revocation remain enforced throughout preparation.

In **Admin → Units**, resolve the missing-schedule and device-enrollment warnings
for every active unit in the group. Select an explicit blank schedule where
scheduled handovers are unnecessary; a missing selection is not a blank schedule.
Enroll each intended browser/app installation, including ordinary workstations.
Readiness verifies at least one live registration per active unit; it cannot
inventory hardware or prove every intended installation was enrolled.

The API checks preparation groups in bounded batches every five seconds. It
automatically enables requirements once the provider is usable and every active
unit has an effective schedule selection and live device registration. Empty
groups are not enabled. Activation is recorded as an automatic audit event and
remains one-way: later withdrawal never restores preparation access. Existing
cookies retain their expiry and device binding. The worker uses separate short
transactions and locks rollout rows before checking readiness, without acquiring
session, unit or registration locks. It never overlaps its own scans.

Once enabled, new production jobs require matching live enrollment, agency
permissions, an explicit effective schedule and current-shift personal proof.
Enrollment, agency mismatch, missing schedule, authentication handover and the
per-call grace reminder have separate clinical explanations. Expiry or withdrawn
access ends the session; shift changes alone leave existing owned reports usable.
Unpaired Admin, Review, existing-report reopening and idempotent continuations
retain their ordinary authorization, as does same-user protected recovery.
Unit warnings remain live after activation, so a later withdrawn device or
missing schedule is visible. Deactivated units keep their report/history links.

## Deployment prerequisites

Configure protected `OIDC_CREDENTIAL_KEYS_JSON` and retain keys required to read
existing active credentials and encrypted CSRF/correlation data. The Admin view
checks the active immutable discovery snapshot, supported PKCE, decryptable
credential and installation-approved personal-proof contract. A mutable draft
snapshot never substitutes for a missing approved active snapshot. Repair those
cases through installation-owner/superadmin recovery; do not fake provider proof.

Configure personal authentication requirements in Admin → Authentication only
after the deployment's issuer, client, claims and fresh personal authentication
behavior have been agreed with regional IT. A generic successful OIDC redirect does not prove
regional AD FS/PAS freshness, user switching or account-disable behavior.

Register active agency hosts and TLS ingress/proxy routing with the original
Host, cookies and same-origin `/api` paths. Copy the exact callback and logout
registration URLs from Admin's provider panel for every registered origin.
Follow [provider setup and rotation](oidc-provider-drafts.md) for registration,
protected secrets, independent local owner/superadmin recovery and key rotation.
Ordinary provider drafts, real tests, activation and credential rotation remain
in Admin. Verify local protected recovery administration before changing SSO.

## Validation and production acceptance

With `DATABASE_URL` pointing to a disposable test database prepared by the database
integration suite, run `npm run test:authentication-rollout -w @open-triage/api`.
This shared earlier check includes general HTTP creation in preparation followed
by explicit enforcement, the synthetic demo fixture, real upgrades, enrollment
and approval races, group throttling and controlled-provider browser redirects.
Enforcement fixtures use one shared explicit rollout helper; missing setup is
never treated as an implicit activation. These tests create test accounts and
reports, so never point this command at a development or production database.

Run focused real PostgreSQL upgrades, enrollment/approval races, sibling-agency
throttling, simultaneous handovers and controlled-provider redirects through the
shared deployment proxy, followed by `DOCKER_COMMAND=docker.exe npm run check:ci`
on WSL (or `npm run check:ci` with Docker). See
[local prerequisites](local-development.md). These use disposable databases,
never reset development fixtures, and fail closed when database coverage is
required. Record automated command results separately from production acceptance.

Slice 20 / [issue 723](https://github.com/open-triage/open-triage-epcr/issues/723)
remains mandatory for regional AD FS v6/PAS and physical Android browser/PWA and
Windows personal-session acceptance, including QR link opening, cached provider
state, explicit switching, expiry, regional disablement and offline recovery.
Automated readiness and a controlled provider do not certify regional production
readiness. Do not enable a regional production rollout until that checkpoint has
passed and the regional operator has approved deployment.

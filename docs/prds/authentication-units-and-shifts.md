# Problem Statement

> **Planned — agreed design, 13 October 2026.** This PRD specifies shared authentication administration, OIDC integration, operational units, device enrollment and shift handovers. It does not claim that these features are implemented or that regional integration and device acceptance checks have passed. The five modules and testing of all five were confirmed by the product owner.

Regional staff need to use their existing personal identities in OpenTriage. Regional IT supports OpenID Connect and SAML through Microsoft AD FS, with Clavister PAS behind it for additional authentication methods such as BankID. Other installations need to continue managing usernames and passwords themselves. Administrators need to configure either arrangement through the application without maintaining separate clinical workflows.

Shared Android devices will stay with operational units while clinicians change shifts. Windows workstations use staff members' own accounts. A device's unit and the person currently using it are separate facts: keeping the ambulance's device must not allow the incoming clinician to take new jobs under the outgoing clinician's identity. Existing reports and encrypted unsynchronized work must remain attributable and recoverable when authentication, pairing or a shift changes.

The application already has local identities, roles, sessions, agency groups, dispatch-linked units and protected offline storage. Its current clinician-to-unit assignment and password-dependent session paths are insufficient for production device binding and organization SSO. Shift times vary by unit, so authentication changes also require unit administration and reusable shift schedules.

# Solution

Provide one shared identity, authorization, session and clinical workflow with two configurable authentication modes: self-managed username/password or managed OIDC. Authentication policy belongs to an agency group and is inherited by its children. Regional deployments can require SSO for ordinary staff while retaining independent installation-owner and superadmin recovery.

Add Admin workspaces for Authentication, Units and Devices, and Shift Schedules. An administrator configures and tests an OIDC provider, approves new external identities, enrolls each shared browser/app installation to a unit with a short-lived QR code, and selects a weekly shift schedule for that unit. Production new-job access follows the enrolled device's unit and the clinician's existing agency permissions. The synthetic demo retains its clinician-to-unit convenience mapping.

Each shift breakpoint has an early-login grace period. A personal login during that period qualifies for the upcoming shift. Opening a new call during the period prompts the clinician to confirm the displayed identity and unit or switch user. At the breakpoint, older authentication must be renewed before taking a new job. The reminder itself does not authenticate anyone or renew a session. An explicitly selected blank schedule disables scheduled handover checks; ordinary authentication, session expiry and revocation still apply.

Shift handovers do not interrupt documentation already in progress. Existing session deadlines and access withdrawal still apply, and identity changes preserve the established encrypted-storage and same-user recovery boundaries.

# User Stories

1. As a regional clinician, I want to sign in with my personal external identity, so that my work is attributed to me without a separate ordinary OpenTriage password.
2. As a clinician in a self-managed agency, I want to keep signing in with an OpenTriage username and password, so that my agency can operate without a external identity provider.
3. As a clinician, I want the same clinical workflow and permissions whichever login mode my agency uses, so that authentication changes do not change how I document care.
4. As an agency administrator, I want authentication policy shared across my parent and child agencies, so that staff have one consistent login policy within the group.
5. As an installation administrator, I want unrelated agency groups to choose their own login mode and provider, so that their identity arrangements remain independent.
6. As an agency administrator, I want to manage only my group's authentication settings, so that another group's integration is protected.
7. As an installation owner or superadmin, I want independent local administrative access, so that I can repair a broken regional integration.
8. As an agency administrator, I want to configure maximum session duration, temporary-password expiry and login-attempt limits, so that self-managed authentication follows the group's policy.
9. As an agency administrator, I want the existing password rules and user-management workflows retained, so that switching to the new settings panel does not silently change password requirements.
10. As an agency administrator, I want to enter the provider name, issuer/discovery address, client identifier, credentials, scopes and supported profile-claim mappings in Admin, so that normal OIDC configuration does not require deployment-file edits.
11. As an agency administrator, I want exact callback and logout-registration URLs, flow details and required claims available to copy, so that regional IT can register the application correctly.
12. As an agency administrator, I want discovered endpoints, signing-key information and discovery health visible, so that I can diagnose an incomplete integration.
13. As an agency administrator, I want to save a draft and test an actual login before activation, so that a configuration error does not immediately replace working authentication.
14. As an agency administrator, I want to replace or rotate credentials without revealing saved secrets, so that I can maintain the integration safely.
15. As an agency administrator, I want configuration status and change history visible, so that I can see what is active and who changed it.
16. As an agency administrator, I want sensitive authentication changes to require fresh authentication, so that an unattended administrative session cannot silently change the login policy.
17. As an agency administrator, I want a newly authenticated but unknown external identity to produce a pending access request, so that SSO success alone does not grant clinical access.
18. As an agency administrator, I want to link an approved external identity to an existing user, so that their roles, reports and audit history remain attached to the same person.
19. As an agency administrator, I want to create a new user and assign roles when approving a genuinely new identity, so that onboarding remains explicit.
20. As a staff member, I want matching email addresses to require administrator review rather than automatic account merging, so that an unrelated identity cannot inherit my account.
21. As an agency administrator, I want application roles to remain under application administration, so that regional profile attributes do not unexpectedly grant privileges.
22. As an agency administrator, I want SSO activation to stop new ordinary password logins while allowing existing sessions to reach their next required authentication or expiry, so that the transition has a predictable boundary.
23. As a clinician, I want logging out of OpenTriage to end my OpenTriage session without logging me out of unrelated regional applications, so that shared-device handover has a limited effect.
24. As a clinician using a shared device, I want switching users to require personal authentication, so that a cached regional session cannot silently select the previous clinician.
25. As an agency administrator, I want existing session-revocation controls to work for SSO users, so that I can withdraw active application access when needed.
26. As an agency administrator, I want to create and maintain operational units with names, call signs and active status, so that device and dispatch assignments refer to the same unit.
27. As an agency administrator, I want units owned by their individual agencies, so that shared staff do not erase operational and clinical boundaries.
28. As an agency administrator, I want a replacement physical ambulance to retain its operational unit's configuration, so that fleet changes do not require recreating shifts and device assignments.
29. As an agency administrator, I want deactivated units to retain historical associations, so that past reports remain understandable.
30. As an agency administrator, I want unit forms to follow the owning agency's published configuration, so that child agencies can provide differentiated forms through the existing configuration workflow.
31. As an agency administrator, I want to generate a single-use QR code valid for five minutes for a selected unit, so that I can enroll a device at the point of use.
32. As a clinician, I want an enrolled device to retain its unit when I log out or change shifts, so that the incoming crew does not need to pair it again.
33. As an agency administrator, I want several named devices attached to one unit and each device attached to only one unit, so that the inventory matches operational use.
34. As an agency administrator, I want to inspect a unit's enrolled devices and revoke a registration, so that a lost or retired installation cannot continue obtaining server access.
35. As an agency administrator, I want to reassign a device with a new QR code and require a fresh clinician login, so that its next jobs use the intended unit and person.
36. As a clinician, I want device reassignment to preserve the author and unit of existing reports, so that moving a device does not rewrite clinical history.
37. As an agency administrator, I want it explained that clearing application data or changing browsers requires enrollment again, so that I understand what the registration identifies.
38. As a clinician authorized for the agency, I want to take the enrolled unit's jobs without a separate production clinician-to-unit roster, so that a staffing change does not require an administrator to reassign me.
39. As a clinician, I want pairing alone to confer no clinical permissions, so that someone holding the device still needs an authorized personal account.
40. As a clinician at an unpaired workstation, I want to finish my existing reports while new-job access remains unavailable, so that stationary work does not require pretending the workstation is an ambulance.
41. As a demonstration user, I want the existing synthetic clinician-to-unit workflow preserved, so that the demo remains usable without production device enrollment.
42. As an agency administrator, I want to create named weekly shift schedules with breakpoints for each weekday, so that I can represent the group's recurring handovers.
43. As an agency administrator, I want schedules reusable across parent and child agencies and selectable per unit, so that different units can share or differ in shift patterns.
44. As an agency administrator, I want each breakpoint to have its own early-login grace period, so that incoming crews can authenticate before their shift starts.
45. As an agency administrator, I want a unit's schedule evaluated in its owning agency's time zone, so that displayed handovers match local operations.
46. As an agency administrator, I want to assign a deliberately blank schedule, so that units without scheduled handovers can operate without shift reminders or checkpoints.
47. As an agency administrator, I want an unselected schedule clearly distinguished from a selected blank schedule, so that incomplete setup cannot accidentally disable handover checks.
48. As a clinician, I want a weekday without a breakpoint to continue the preceding shift, so that a missing event does not invent a handover.
49. As a clinician starting early, I want my personal login during the grace period to qualify for the upcoming shift, so that I do not need another login at its start.
50. As a clinician opening a new call during the grace period, I want a dialog showing the signed-in name and unit with Continue and Switch user actions, so that I can spot the previous crew's identity.
51. As a clinician, I want confirmation of that reminder to leave authentication freshness and session expiry unchanged, so that a reminder cannot be mistaken for login.
52. As a clinician whose authentication predates the incoming shift's grace period, I want to authenticate again before taking a new job after handover, so that the application checks who is now using the device.
53. As a clinician documenting an existing report, I want a shift breakpoint alone to leave that work available, so that handover does not interrupt an ongoing case.
54. As an agency administrator, I want schedule edits to apply prospectively with their effective time visible, so that editing the next handover does not unexpectedly change the current shift's requirements.
55. As a clinician, I want maximum session expiry to lock the workspace while retaining eligible encrypted unsynchronized work, so that access ends without silently losing my work.
56. As a clinician, I want actual personal authentication to satisfy shift, sensitive-action and recovery checks, so that silent regional-session reuse does not impersonate my presence.
57. As a clinician returning to a device, I want to recover my eligible pending work after the required authentication, so that switching users or restarting does not discard my records.
58. As a clinician sharing a device, I want the next user unable to view my protected pending records or their identifying labels, so that handover preserves confidentiality.
59. As a clinician, I want clear explanations when new-job access needs login, enrollment or schedule setup, so that I know how to resume work.
60. As a clinician affected by an identity-provider outage, I want existing eligible work to follow the established session and offline limits, so that the outage does not silently change the access rules.
61. As an agency administrator, I want device revocation and user-session revocation to remain distinct actions, so that I can withdraw a device or a person's access at the appropriate scope.
62. As an agency administrator, I want clear limits on revoking an offline device, so that I do not assume it can be remotely locked before reconnecting or reaching its local session deadline.
63. As a clinician, I want identity, unit, agency and handover state to remain consistent across tabs and retries, so that a stale screen cannot open a job in the wrong context.
64. As an administrator or reviewer, I want existing authorized administrative and retrospective work to remain usable without ambulance pairing, so that new-job restrictions do not disable unrelated workspaces.
65. As a regional IT administrator, I want automatic discovery of provider signing-key changes, so that routine key rotation does not require manually replacing a single verification certificate in OpenTriage.
66. As an installation operator, I want provider integration and shared-device handover tested before rollout, so that the chosen AD FS/PAS setup is shown to require the intended person's authentication.

# Implementation Decisions

## Confirmed module boundaries

The product owner confirmed these five modules and testing of all five. Each owns its domain rules and exposes a small interface; its Admin or clinical screens use that interface rather than reimplementing policy.

| Module | Responsibility | Stable interface and outcomes |
| --- | --- | --- |
| Authentication configuration and providers | Group policy, local authentication, OIDC discovery and protocol handling, credential protection, drafts, testing and activation | Read effective policy; save/test/activate a version; begin/complete authentication for a declared purpose. Produce validated identity and authentication evidence, never clinical authorization. |
| Identity, onboarding and sessions | External-identity linkage, pending requests, shared application sessions, authentication freshness, expiry and revocation | Resolve validated identity to an approved application user or pending request; approve/link; issue/validate/end sessions; require recent authentication for a specific purpose. |
| Units and device enrollment | Agency-local unit lifecycle, device inventory, QR enrollment, reassignment and revocation | Manage units; issue/consume enrollment; resolve a live device binding; reassign/revoke. Return authoritative unit and agency context independently of the clinician's permissions. |
| Shift schedules and new-job access | Shared weekly schedules, effective versions, grace windows and authoritative new-job decisions | Evaluate a schedule at a server instant; authorize a new-job attempt using current session, device, agency and call state. Return allow, identity-reminder requirement, fresh-authentication requirement or a specific setup/access failure. |
| Clinical session transitions and recovery | Login/switch/expiry UX, grace dialog, workstation behavior, stale-context handling and protected pending work | Coordinate authenticated transitions, lock/unlock existing protected storage and resume eligible same-user work. Reuse the common behavior for local and OIDC authentication. |

## Common identity and group policy

- Keep the existing immutable application user as the author and authorization subject. Authentication method is a way to prove that identity; units and external identities do not become report owners.
- Extend the existing external-identity concept with sufficient integration, issuer, subject and group scoping to prevent collisions. Do not use email or editable profile mappings as identity keys. Changing an issuer must not silently reinterpret existing links.
- Decouple session validation, user directories, roles, session administration and protected recovery from the existence of a local password credential. An SSO-only user must not need a dummy password or disappear from administration.
- Keep role assignment, disabled-user checks, agency boundaries, host-origin checks and capability enforcement common. Identity-provider profile claims do not grant application roles.
- Successful authentication by an unknown external identity creates or resolves a pending request. It grants no ordinary clinical or administrative access. An authorized administrator either links an existing user or creates a user and assigns roles; duplicate submissions and competing approvals must not create conflicting links.
- One effective authentication policy belongs to the root agency group and is inherited by its children. Unrelated groups remain independent. Agency administrators manage their own group; installation owners and superadmins retain their existing broader authority and independent local recovery path.
- Move the applicable authentication controls into this common policy: maximum application-session duration, temporary-password expiry and configurable login-attempt limits. Preserve the existing fixed password rules, including the minimum length of 12 characters, and existing installation/ingress protections. Policy inheritance must not let sibling-agency switching bypass account limits.
- Password-specific actions remain meaningful only for accounts with applicable local credentials. Shared user lifecycle, roles, session listing and revocation must work for either authentication mode.
- Preserve the local synthetic demonstration path without turning it into a password fallback for ordinary staff in an SSO-only group.

## OIDC integration and Authentication administration

- Implement conventional server-side authorization-code OIDC using a maintained protocol library. Provider secrets and tokens stay server-side; successful authentication results in the application's own session. The regional AD FS version is confirmed as v6. Use PKCE where supported by that deployment and client registration; verify configured compatibility before production activation.
- Bind each authentication transaction to its group, registered agency origin, intended action and allowed return destination. Validate state, nonce, issuer, audience, signatures, token validity and one-time use as appropriate to the protocol. Preserve existing CSRF and tenant protections through the cross-site callback rather than broadly weakening session-cookie policy.
- Use discovery and the provider's advertised signing keys, including normal key rollover. Cache and refresh keys safely; reject an unverifiable token. Regional SAML certificate instructions explain the rotation requirement but do not create a SAML implementation commitment.
- Distinguish normal login from explicit fresh-personal-authentication requests for shared-device login, user switching, shift checks, sensitive administration and protected recovery. A silent callback, token refresh or application reminder cannot advance the stored fresh-authentication time. Validate the regional mechanism and its evidence with AD FS/PAS; a requested prompt alone is not proof that the intended person authenticated.
- OpenTriage logout ends the relevant application session and locks local clinical state. It does not invoke blanket provider logout. A subsequent shared-device login must not silently inherit the outgoing user's external identity.
- A same-user reauthentication must return the expected subject. A different subject follows the user-switch transition and cannot unlock the former user's pending work.

The OIDC panel is the complete interface for normal integration configuration:

| Panel area | Behavior |
| --- | --- |
| Editable provider configuration | Provider display name, issuer/discovery address, client ID, replacement credentials, scopes and supported profile-claim mappings. Required values and validation errors are visible. |
| Secret handling | Show whether a credential is configured; accept replacement/rotation. Never return a saved secret to the browser or include it in history, exports or diagnostics. |
| Registration details for IT | Show copyable exact callback and any applicable logout-registration URLs, supported flow, required claims and the addresses needed for the group's agency hosts. Showing a logout URL does not enable global provider logout. |
| Discovered information | Show issuer, relevant endpoints, signing-key identifiers and discovery/validation health as read-only metadata. |
| Lifecycle | Save a draft, check connectivity/discovery, perform a real test login, activate a tested configuration and inspect configuration history. Failed or incomplete drafts leave the active configuration intact. |
| Effective policy | Show active login mode, group inheritance, maximum session duration, applicable local controls and incomplete/error states. |

Sensitive mode, provider and credential changes require recent authentication and audit. Test success must belong to the configuration being activated; changing relevant draft values invalidates its previous test result. This version-binding is an implementation inference needed to make “test before activation” meaningful. Administrative configuration must also validate provider URLs and constrain outbound fetching so that discovery cannot be used to access arbitrary internal services; regional private-network IdP hosting must remain supportable.

Activating SSO requires a successful test login first. New ordinary local-password logins then stop. Existing local sessions can continue until their next required authentication or normal expiry; any new required authentication follows the active SSO policy. Installation recovery and the synthetic demonstration exception remain explicitly scoped.

DNS, TLS, installation secret-encryption infrastructure and deployment routing remain installation responsibilities. Ordinary OIDC setup and credential changes must not require editing deployment configuration. The exact regional registration values and supported client-authentication method are supplied by IT, not guessed in this PRD.

## Sessions, offboarding and outages

- Keep one application-session lifecycle for local and OIDC users. Track authentication source and fresh-personal-authentication evidence separately from ordinary activity, refreshes and identity-reminder confirmations.
- Maximum application-session duration is separately configurable from shift schedules. A fresh personal login starts a new session duration; a dialog acknowledgment, background refresh or activity does not. Preserve the existing limited-purpose recent-authentication gate for sensitive actions and recovery.
- Reuse session-revocation administration and extend it to SSO accounts. Administrators must revoke all affected application sessions when immediate withdrawal across a user's devices is required. Disabling the local application user must continue to deny subsequent authorized server requests.
- Disabling the external identity is expected to prevent subsequent valid organization authentication, but does not itself revoke already-issued OpenTriage sessions. The actual AD FS/PAS treatment of cached regional sessions must be verified. A return after revocation must require the appropriate fresh personal authentication rather than silently minting another application session.
- In an SSO-only group, an IdP outage prevents login and new-job access that requires fresh authentication. Existing eligible work continues within ordinary session, authorization and offline limits. Do not introduce a silent password fallback or emergency bypass.
- Expiry and revocation lock access independently of shift rules. Online requests consult current session and access state. A disconnected device cannot be promised immediate remote locking: already-unlocked offline work remains bounded by its existing local session deadline and is reassessed on reconnection.

## Operational units and device enrollment

- A unit is an agency-owned operational identity/call sign, not a physical fleet asset. Expose name, call sign, active state, selected schedule and enrolled devices. Preserve dispatch's agency-and-call-sign routing and historical unit references. A physical vehicle replacement does not require a new operational unit.
- Use the owning agency's published clinical configuration when opening a report. Different forms are handled by child agencies; this feature adds no per-unit form override.
- A device registration identifies one browser/PWA/app installation. It is not hardware attestation. Clearing its data, changing browser or using a different storage context requires enrollment again; an old registration remains administratively revocable.
- An authorized administrator selects a unit and generates a single-use enrollment QR that expires after five minutes. Consume it atomically and issue the installation's binding credential. The QR contains no clinician login or clinical data. Enrollment must resolve to the intended installation rather than silently pairing a separate scanner/browser context.
- One installation has exactly one live unit binding; a unit may have multiple named installations. Pairing survives clinician logout and shift changes, but grants no user or agency permissions. Device credentials and clinician sessions are separate, revocable authorities.
- Taking new unit jobs requires an active authorized clinician, the appropriate agency context and an active enrolled device for the call's unit. Generated synthetic calls follow the same route, without a Demo-role requirement for the recipient. Unit routing does not depend on a clinician-to-unit roster; existing roster fallback remains only during staged preparation before enforcement.
- Reassignment uses a new admin-issued QR, invalidates the old active context and signs out the current clinician. Require a fresh clinician login before work in the new unit; stale tabs and sessions associated with the prior device context cannot continue taking jobs there.
- Revoking a unit pairing withdraws only its new-call authority. Personal sign-in, personal sessions, existing authorized reports and owner-authorized recovery remain available. Explicit user-session revocation remains separate. Generated synthetic calls follow the same unit routing as production calls and can be received by any authorized clinician on a device paired to their target unit; generation requires Demo permission and all synthetic provenance is retained.
- Reassignment, revocation and unit deactivation do not rewrite the author, agency or unit of an existing report. Preserve eligible encrypted unsynchronized work for authorized recovery. They do not constitute remote data erasure.
- An unpaired workstation may continue the clinician's existing authorized reports but cannot take new production jobs. Preserve existing Admin, Review and other authorized retrospective access; this is a repository-preservation inference, not an additional pairing prerequisite for those workspaces.

## Shift schedules and grace periods

- Administrators create named weekly schedules shared within an agency group. Each weekday may contain breakpoints, each with its own early-login grace duration. Each unit explicitly selects a schedule. The unit's owning agency supplies the time zone, even when another agency in the group uses the same schedule.
- A weekday with no breakpoint continues the most recent scheduled shift, including across midnight and the weekly boundary. A schedule with no breakpoints anywhere is intentionally blank and has no shift-authentication checkpoint or grace reminder.
- Missing schedule selection is incomplete setup and blocks taking new production jobs. Selecting a blank schedule is valid setup and does not block those jobs on shift grounds. Ordinary permissions, enrollment, revocation and session expiry remain in force in either case.
- Grace is an early-login window before a breakpoint, not extra time after it to keep using the previous identity. A personal login at or after the window's start qualifies for the coming checkpoint; an earlier authentication does not.
- At a new-job attempt after a breakpoint, require authentication sufficiently recent for the active shift. Check the session being used on this device; authentication in another session or on another device must not silently satisfy it.
- For every new call opened during an early grace window, show the signed-in clinician's name and unit with **Continue as [name]** and **Switch user** actions. Continue records the reminder response for that attempt but does not update authentication evidence or session expiry. Switch follows the ordinary fresh-authentication and protected-storage transition.
- A reminder response belongs to the current attempt, clinician, device, unit and schedule context. If that context changes or the attempt crosses a checkpoint, reassess on the server before opening the call. A browser-only flag cannot bypass the new-job rules.
- Shift changes alone do not end sessions, transfer reports or lock existing documentation. Reopening an already-created report is not a new job; existing report authorization still applies. Session expiry, user/device revocation and other access withdrawal are separate controls.
- Schedule edits preserve the current shift's requirements and affect future handovers. Show when a change becomes effective. Exact transition rules for adding/removing all breakpoints, changing time zones and daylight-saving anomalies are implementation decisions to settle and test before delivery; they must not cause retrospective handovers.

Illustrative acceptance examples use a 07:00 breakpoint with a 15-minute grace period, a valid unexpired session and otherwise valid authorization:

| Situation | Required outcome |
| --- | --- |
| Personal login at 06:44; new call at 06:50 | Show the identity reminder. Continuing does not make this authentication qualify for 07:00. |
| Personal login at 06:45; new call at 06:50 | Show the identity reminder. This login qualifies for the 07:00 checkpoint. |
| Personal login at 06:44; first new call at or after 07:00 | Require fresh personal authentication before opening it. |
| Personal login at 06:45; first new call at or after 07:00 | The 07:00 checkpoint is satisfied; apply other ordinary access checks. |
| Report already open before 07:00 | The breakpoint alone does not block continued documentation. |
| A selected schedule has no breakpoints | No shift reminder or checkpoint; ordinary session and device rules apply. |
| No schedule has been selected | Explain incomplete unit setup and deny a new production job. |

## Authoritative new-job access and clinical transitions

- Keep call listing, new-job authorization and call/report ownership consistent. The new-job operation resolves the current live unit binding and checks clinician permission, agency, active unit, call assignment/status, selected schedule, authentication freshness and any required reminder response on the server.
- Perform the decision with the existing call-opening concurrency and idempotency guarantees so retries cannot create duplicate reports or bypass access checks after cancellation, reassignment, revocation or a competing open. Do not hold a database transaction open while waiting for an IdP or clinician interaction.
- Return actionable states such as enrollment required, schedule selection required, identity confirmation required, reauthentication required, expired session or withdrawn access. Do not let the client invent authorization from cached settings.
- Preserve the existing agency-switch safeguards, including synchronization, storage locking, hostname and stale-tab checks. Changing agency in the UI does not reassign a device to another agency's unit.
- For logout, user switching, expiry and reassignment, reuse protected-storage lifecycle behavior: settle pending local writes, discard in-memory plaintext and keys, and retain eligible encrypted pending work within its existing recovery deadline. Do not extend that deadline merely because someone logs in or pairs again.
- Recovery remains online, report-scoped and subject to the same user's current authorization and recent authentication. Adapt password-dependent recovery to the common authentication interface. Another clinician must not receive the prior user's labels, report keys or drafts.
- Preserve already-unlocked offline editing within existing deadlines, cross-tab protections, signing restrictions and the existing handling of late/offline completion. This PRD does not redefine report ownership or grant offline restart authentication.
- Use the existing Admin shell and shared controls for authentication, unit/device and schedule management. Show inheritance, effective state, unsaved changes and actionable failures. Follow the established responsive, keyboard-accessible English/Swedish UI conventions; keep directories bounded and editors consistent with the UI style guide.

## Persistence, migration and audit

These are required persistence responsibilities, not a prescribed table layout:

- Group authentication policies and versioned provider configurations, protected credentials, test/activation evidence and configuration history.
- External-identity links and pending approvals, with uniqueness and group ownership enforced independently of editable display attributes.
- Session authentication provenance, trustworthy freshness and associated device context, without requiring a local password row.
- Agency-owned units, installation registrations and binding lifecycle, single-use expiring enrollment records, and audit events for enrollment, reassignment and revocation.
- Group-owned weekly schedules, per-breakpoint grace values, unit selection and the effective versions needed for prospective edits.

Use relational ownership and uniqueness constraints, short transactions and indexes matching authorization and directory queries. Resolve races in QR consumption, identity approval and new-job creation at the persistence boundary. Keep security events attributable without logging secrets, provider tokens, enrollment credentials or patient content.

Migrate existing users, report authorship, unit references and audit links without recreating identities. Existing local authentication must continue during a staged rollout. Consolidating agency-level authentication settings into group policy requires explicit treatment of conflicting existing child values; do not silently reset those values or weaken throttling. Missing schedules and unenrolled production devices must be visible preparation work before enforcing the new production-job requirements. Preserve the explicitly synthetic fixture path.

# Testing Decisions

All five modules are selected for testing. Tests must verify observable behavior at the service, real PostgreSQL and browser boundaries rather than mirror private helpers. Use focused pure tests for deterministic schedule evaluation, database tests for authority and concurrency, browser tests for user transitions, and a controlled OIDC provider for real redirect/code-exchange integration. Mock-only success tests are insufficient evidence of regional compatibility.

| Module | Required behavioral coverage |
| --- | --- |
| Authentication configuration and providers | Group inheritance and unrelated-group isolation; authorized reads/changes; fresh-authentication gates; secret masking; invalid/unsafe discovery addresses; draft/test/activation binding; failed activation preserving the active provider; local settings and throttles; real authorization-code flow and supported PKCE; state, nonce, issuer, audience, expiry and replay failures; allowed return origins; overlapping/rotating signing keys; unknown-key refresh and unverifiable-token rejection; local-only app logout. |
| Identity, onboarding and sessions | Unknown identity stays pending with no clinical access; explicit link preserves roles and history; no email merge; competing approval and duplicate requests; issuer/provider/group collisions; SSO users without local credentials in every shared admin/session path; live disable/revoke checks; session maximum and freshness; authentication in another session does not qualify this session; wrong-subject reauthentication becomes a safe switch; SSO activation stops new local login and governs the next required authentication; installation recovery remains available. |
| Units and device enrollment | Agency ownership and dispatch call-sign routing; deactivation preserves history; multiple devices per unit and one binding per installation; expired, replayed, forged and concurrently consumed QR attempts; group/unit authorization; persistence across logout; clearing data requires enrollment; reassignment invalidates stale context and requires login; unit-pairing revocation denies new unit calls while preserving personal sessions, existing work and unrelated devices; no pairing-derived role grants; real production calls cannot use the demo exemption. |
| Shift schedules and new-job access | Per-day and per-unit schedules; midnight/week wrap; blank weekdays and entirely blank schedules; missing selection; grace start/end boundaries and zero grace; agency time zones and daylight-saving transitions; prospective edits including blank/nonblank transitions; authoritative time; every grace-period new call requires the reminder; Continue does not authenticate or extend expiry; checkpoint crossed while a dialog/login is open; atomic cancellation/reassignment/revocation races; idempotent reopen does not become a new job; existing work remains usable solely across a shift boundary. |
| Clinical session transitions and recovery | Both login modes in the same clinical flow; shared-device Continue/Switch behavior; unpaired workstation existing-report access and new-job denial; preserved Admin/Review access; session expiry and online revocation; pending encrypted work after logout, switch, reassignment and revocation; same-user online recovery through either auth mode; other-user labels and keys unavailable; unchanged recovery and offline deadlines; cross-tab/agency context; IdP outage without unauthorized fallback; no regional global logout. |

Use real browser redirects through the deployment proxy and registered agency origins to catch callback-cookie, CSRF and tenant-routing regressions. Test on the intended Android browser/PWA installation, including where scanning opens the enrollment link, and on Windows with personal Windows sessions. Exercise normal login, explicit user switching, shift reauthentication and regional account disablement with cached AD FS/PAS state. These regional checks are acceptance dependencies, not behavior a local test provider can prove.

Database migration coverage must preserve existing report/user/unit relationships, group boundaries, synthetic fixtures and inherited policy values. Include representative simultaneous handover traffic, enrollment/approval races and authentication throttling so shift changes do not expose authorization races or accidental sibling-agency bypasses.

Relevant repository prior art to extend:

- Shared login, expiry and recent authentication: [clinician-session API tests](../../apps/api/tests/clinician-session.test.mjs), [session administration](../../apps/api/tests/session-administration.test.mjs), [browser session startup](../../apps/web/e2e/session-startup.spec.ts) and [web session behavior](../../apps/web/tests/clinician-session.test.ts).
- Identity and group isolation: [user provisioning](../../apps/api/tests/user-provisioning.test.mjs), [user lifecycle](../../apps/api/tests/user-lifecycle.test.mjs), [agency authentication in PostgreSQL](../../apps/api/tests/agency-authentication-postgres.integration.test.mjs), [multi-agency PostgreSQL behavior](../../apps/api/tests/multi-organization-postgres.integration.test.mjs) and [installation accounts](../../apps/api/tests/installation-accounts-postgres.integration.test.mjs).
- Call authority and UI: [assigned-call API tests](../../apps/api/tests/assigned-calls.test.mjs), [assigned-call browser tests](../../apps/web/e2e/assigned-calls.spec.ts) and [agency time-zone tests](../../apps/web/tests/agency-time-zone.test.ts).
- Protected transitions: [recovery authentication gate](../../apps/web/tests/recovery-reauthentication-gate.test.ts), [offline report behavior](../../apps/web/tests/offline-reports.test.ts), [database recovery lifecycle](../../packages/database/tests/offline-recovery-lifecycle.test.mjs) and [protected-storage artifacts](../../packages/database/tests/protected-offline-storage-artifacts.test.mjs).
- Authentication abuse controls and migrations: [authentication throttling](../../apps/api/tests/authentication-throttle.test.mjs), [database throttle artifacts](../../packages/database/tests/authentication-throttle-artifacts.test.mjs) and [migration runner](../../packages/database/tests/migration-runner.test.mjs).

Implementation validation must include the applicable focused checks and the repository's `npm run check:ci` application, browser, deployment, database and scale preflight, with prerequisites from the [local development runbook](../runbooks/local-development.md). Record regional and physical-device acceptance separately from automated test results. This documentation change itself does not constitute those checks.

# Out of Scope

- SAML implementation in this release, including a separate SAML certificate-management interface.
- Direct BankID integration; any BankID flow is mediated by the regional AD FS/PAS configuration.
- Automatic directory synchronization, SCIM, identity-provider group-to-role provisioning or automatic email-based account linking.
- New MFA, passkey, password-composition/rotation policy, self-service forgotten-password delivery or emergency clinical authentication bypasses. Organization authentication methods remain the provider's responsibility.
- Production clinician-to-unit staffing rosters, payroll or workforce scheduling. Weekly schedules define authentication handovers, not attendance.
- Physical vehicle/fleet management, hardware identity guarantees, attestation, MDM, remote erasure or a new native mobile application.
- Per-unit form configuration; agency and child-agency forms remain the source of clinical configuration.
- Global logout from all regional applications or a promise that regional disablement instantly ends every existing OpenTriage or offline session.
- Transfer of clinical authorship, access to another clinician's unfinished drafts, redesigned signing/late-entry rules or replacement of protected offline storage.
- A general integration marketplace, arbitrary protocol scripting or general audit-history browser beyond the configuration and lifecycle history required here.

# Further Notes

## Relationship to existing specifications

This PRD extends [Users and Roles](users-roles.md), [Multi-agency](multi-agency.md), [Admin Controls](admin-controls.md) and [Protected Offline Clinical Storage](protected-offline-clinical-storage.md). It brings their deferred external authentication, operational-unit administration and installation enrollment/revocation into planned scope. It does not claim those older deferrals have already been delivered, and physical fleet management remains outside scope.

Retain the current [protected offline operating boundaries](../protected-offline-clinical-storage.md), [browser-state compatibility rules](../browser-state-compatibility.md) and [UI style guide](../design/ui-style-guide.md). The repository currently uses its own application sessions and local credentials; this plan does not replace them with a separate hosted identity product. Extend the shared behavior rather than building an SSO-only clinical stack.

## Regional integration dependencies

Regional IT confirmed conventional OIDC/SAML support through AD FS and possible onward authentication through Clavister PAS. The product owner confirmed the regional AD FS version as **v6** on 13 October 2026. Development can proceed against a controlled OIDC provider while IT prepares registration. Production activation still needs the regional issuer/discovery address, client registration and credentials, allowed redirects for the relevant hosts, required scopes/claims and a test identity.

Microsoft documents [AD FS OIDC flows and PKCE availability](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/overview/ad-fs-openid-connect-oauth-flows-scenarios), including PKCE support in AD FS 2019 and later. The regional version is confirmed as AD FS v6; verify the configured client-registration support. The [AD FS logout documentation](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/development/ad-fs-logout-openid-connect) and [SSO settings](https://learn.microsoft.com/en-us/windows-server/identity/ad-fs/operations/ad-fs-single-sign-on-settings) also show why application logout, provider cookies and fresh authentication require separate acceptance checks. Follow [OIDC signing-key rotation](https://openid.net/specs/openid-connect-core-1_0.html#RotateSigKeys) through discovery rather than pinning a single signing certificate.

Specifically verify with IT that the chosen AD FS/PAS flow can require the intended person's fresh authentication on a shared Android installation; that returned evidence is sufficient to enforce freshness; and that a disabled SSO user cannot regain application access through cached provider state. Verify Windows personal-session behavior separately. A successful generic OIDC test or a `prompt=login` request alone does not settle these deployment-specific questions.

## Engineering decisions to resolve during implementation

The following details were not separately chosen by the product owner and must not be presented as agreed defaults:

- Define deterministic behavior for nonexistent and repeated local breakpoint times during daylight-saving changes, agency time-zone changes and overlapping grace windows. Set validation bounds for grace durations and duplicate breakpoints; make the displayed next checkpoint match server evaluation.
- Define the exact prospective effective-time rule for edited schedules, unit schedule reassignment and transitions to or from an entirely blank schedule. Preserve the agreed current-shift behavior and show the effective result before saving.
- Define migration handling for conflicting existing authentication values within a group and for existing units without a schedule or enrolled device. Make preparation and activation explicit without silently weakening existing controls.
- Choose the maintained OIDC library, supported credential-authentication mechanism and protected credential storage in line with deployment capabilities and the regional registration. Determine callback correlation cookies narrowly enough to retain existing session/CSRF guarantees.
- Confirm which returned claim or validated mechanism proves fresh personal authentication through AD FS/PAS, including user switching and account disablement. If the identity provider cannot supply the required behavior, treat that as an integration blocker to resolve with IT rather than treating silent SSO as fresh login.

No exact regional endpoint, secret, grace default, shift template or rollout date is invented here. The 07:00/15-minute example is an acceptance illustration, not a mandatory schedule.

<!-- android-app:parent -->

# Android application: shared UI, vehicle pairing and standard MDM deployment

Status: Published; approved for implementation.

Repository: `open-triage/open-triage-epcr`

Implementation branch: `feature/android_app`

Source PRD: `docs/prds/android-app.md` at commit `4fb8d1b68ec2313b8300f8e8d18af512ead79b53`.

## Delivery hierarchy

- [001: Import vehicle pairing and sign in to the bundled Android app](https://github.com/open-triage/open-triage-epcr/issues/799) — **AFK**. Blocked by: none.
- [002: Scan the existing vehicle-pairing QR in Android](https://github.com/open-triage/open-triage-epcr/issues/800) — **AFK**. Blocked by: [#799](https://github.com/open-triage/open-triage-epcr/issues/799).
- [003: Document offline and recover work after Android process restart](https://github.com/open-triage/open-triage-epcr/issues/801) — **AFK**. Blocked by: [#799](https://github.com/open-triage/open-triage-epcr/issues/799).
- [004: Provision and lock server settings through standard Android management](https://github.com/open-triage/open-triage-epcr/issues/802) — **AFK**. Blocked by: [#799](https://github.com/open-triage/open-triage-epcr/issues/799).
- [005: Revoke or reassign Android installations without losing pending work](https://github.com/open-triage/open-triage-epcr/issues/803) — **AFK**. Blocked by: [#801](https://github.com/open-triage/open-triage-epcr/issues/801), [#802](https://github.com/open-triage/open-triage-epcr/issues/802).
- [006: Complete OIDC sign-in and personal reauthentication in the APK](https://github.com/open-triage/open-triage-epcr/issues/804) — **AFK**. Blocked by: [#801](https://github.com/open-triage/open-triage-epcr/issues/801).
- [007: Switch authorized agencies without leaking Android session or draft state](https://github.com/open-triage/open-triage-epcr/issues/805) — **AFK**. Blocked by: [#803](https://github.com/open-triage/open-triage-epcr/issues/803), [#804](https://github.com/open-triage/open-triage-epcr/issues/804).
- [008: Capture and view photo notes over the configured Android connection](https://github.com/open-triage/open-triage-epcr/issues/806) — **AFK**. Blocked by: [#801](https://github.com/open-triage/open-triage-epcr/issues/801).
- [009: Record and play audio notes over the configured Android connection](https://github.com/open-triage/open-triage-epcr/issues/807) — **AFK**. Blocked by: [#801](https://github.com/open-triage/open-triage-epcr/issues/801).
- [010: Sign, review and download reports through the shared Android UI](https://github.com/open-triage/open-triage-epcr/issues/808) — **AFK**. Blocked by: [#806](https://github.com/open-triage/open-triage-epcr/issues/806), [#807](https://github.com/open-triage/open-triage-epcr/issues/807).
- [011: Preserve the shared workflow through Android navigation and layout changes](https://github.com/open-triage/open-triage-epcr/issues/809) — **AFK**. Blocked by: [#801](https://github.com/open-triage/open-triage-epcr/issues/801).
- [012: Provision server TLS and replace CA trust without rebuilding the APK](https://github.com/open-triage/open-triage-epcr/issues/810) — **AFK**. Blocked by: [#799](https://github.com/open-triage/open-triage-epcr/issues/799), [#802](https://github.com/open-triage/open-triage-epcr/issues/802).
- [013: Establish the production signing identity and verify a signed APK upgrade](https://github.com/open-triage/open-triage-epcr/issues/811) — **HITL**. Blocked by: [#801](https://github.com/open-triage/open-triage-epcr/issues/801).
- [014: Download a compatible signed APK from Admin](https://github.com/open-triage/open-triage-epcr/issues/812) — **AFK**. Blocked by: [#811](https://github.com/open-triage/open-triage-epcr/issues/811).
- [015: Configure installation-wide APK upgrade grace in Super-admin](https://github.com/open-triage/open-triage-epcr/issues/813) — **AFK**. Blocked by: [#812](https://github.com/open-triage/open-triage-epcr/issues/812).
- [016: Require upgrades before new work while preserving retained drafts](https://github.com/open-triage/open-triage-epcr/issues/814) — **AFK**. Blocked by: [#801](https://github.com/open-triage/open-triage-epcr/issues/801), [#802](https://github.com/open-triage/open-triage-epcr/issues/802), [#812](https://github.com/open-triage/open-triage-epcr/issues/812), [#813](https://github.com/open-triage/open-triage-epcr/issues/813).
- [017: Accept installation, configuration and upgrades through Intune](https://github.com/open-triage/open-triage-epcr/issues/815) — **HITL**. Blocked by: [#800](https://github.com/open-triage/open-triage-epcr/issues/800), [#802](https://github.com/open-triage/open-triage-epcr/issues/802), [#803](https://github.com/open-triage/open-triage-epcr/issues/803), [#810](https://github.com/open-triage/open-triage-epcr/issues/810), [#812](https://github.com/open-triage/open-triage-epcr/issues/812), [#814](https://github.com/open-triage/open-triage-epcr/issues/814).
- [018: Accept standard app management through combined Headwind/MDMesh](https://github.com/open-triage/open-triage-epcr/issues/816) — **HITL**. Blocked by: [#800](https://github.com/open-triage/open-triage-epcr/issues/800), [#802](https://github.com/open-triage/open-triage-epcr/issues/802), [#803](https://github.com/open-triage/open-triage-epcr/issues/803), [#810](https://github.com/open-triage/open-triage-epcr/issues/810), [#812](https://github.com/open-triage/open-triage-epcr/issues/812), [#814](https://github.com/open-triage/open-triage-epcr/issues/814).
- [019: Accept the complete APK workflow on a physical phone and tablet](https://github.com/open-triage/open-triage-epcr/issues/817) — **HITL**. Blocked by: [#800](https://github.com/open-triage/open-triage-epcr/issues/800), [#803](https://github.com/open-triage/open-triage-epcr/issues/803), [#804](https://github.com/open-triage/open-triage-epcr/issues/804), [#805](https://github.com/open-triage/open-triage-epcr/issues/805), [#808](https://github.com/open-triage/open-triage-epcr/issues/808), [#809](https://github.com/open-triage/open-triage-epcr/issues/809), [#810](https://github.com/open-triage/open-triage-epcr/issues/810), [#814](https://github.com/open-triage/open-triage-epcr/issues/814).

All 49 source user stories are mapped in the child bodies and publication manifest. The first three slices form the initial manual-install/pair/offline/restart/recovery milestone. Each implementation slice includes its own tests. The four HITL tickets require actual signing-owner or deployment/device input. All 19 tickets are attached as real GitHub sub-issues; blocker links specify implementation order.

## Source PRD

# Problem Statement

> **Planned — design agreed on 11 November 2026.** This PRD records the Android
> packaging, provisioning, distribution, compatibility and validation scope
> agreed with the product owner. The implementation modules and broad regression,
> Android and MDM testing scope were accepted during the design discussion.
> No Android implementation or deployment acceptance is claimed by this document.

IT needs an installable Android application that its mobile device management
(MDM) system can distribute to ambulance devices. OpenTriage currently runs as a
web application. Maintaining a second clinical interface would duplicate work
and allow behavior to diverge, while future connections to Bluetooth equipment
will require a suitable native integration boundary.

Deployments must remain independent of a particular MDM product. Initial targets
are a combined Headwind MDM/MDMesh deployment and Microsoft Intune. Some devices
will receive the APK manually. Administrators need to prepare their connection
and vehicle association centrally, including trust for an IT-operated internal
certificate authority (CA), without asking an installer to type connection
settings or configure certificates in Android Settings.

Server and Android releases will roll out independently. IT needs a predictable,
administered upgrade period, and clinicians must retain their pending work when
an application update, connectivity loss, session change or device reassignment
occurs. Packaging must preserve the existing confidentiality and online-recovery
boundaries of protected drafts.

# Solution

Ship one signed Capacitor APK containing a build of the existing web application.
Maintain one UI, one set of clinical workflows and one authorization model across
browser and Android delivery. Open in Mobile mode initially while keeping the
existing role-permitted Stationary, Review and Admin functionality available.

Expose the compatible Android release in Admin with a download action, version,
versioned download URL and SHA-256 checksum. IT can distribute that artifact
through MDM or use it for manual installation. UI updates ship in versioned APKs;
web deployments do not replace the UI inside installed APKs.

Extend the existing Admin unit/vehicle pairing process. After installation, one
scan or import supplies the connection and public CA trust information and
completes the existing confirmed, single-use unit enrollment. The resulting
device registration remains separate from clinician sign-in and permissions.
Use application-specific CA trust for this manually provisioned path so that
Android Settings is not a prerequisite. Managed devices receive configuration
through Android's standard managed-configuration interface, with managed values
taking precedence over local setup.

Support Android 13 or newer with an updated Android System WebView. The initial
MDM target is organization-owned, fully managed or dedicated devices. Keep
synchronization and assignment refresh tied to the foreground, and retain the
current requirement for connectivity to recover encrypted drafts after process
restart. Bluetooth integrations are future work.

Provide an installation-wide APK upgrade grace period in Super-admin, defaulting
to 90 days. The setting operates within the server's declared compatible client
versions. An expired upgrade deadline prevents starting new work while preserving
pending drafts and a recovery path through an application update.

# User Stories

1. As an IT administrator, I want one signed APK usable across installations, so that I can maintain one application artifact in our MDM catalog.
2. As a deployment operator, I want the same APK usable with our combined Headwind/MDMesh system and Intune, so that our choice of MDM does not determine the clinical application.
3. As an evaluator, I want to install the APK manually, so that I can exercise the application without first deploying an MDM system.
4. As an administrator, I want to download a compatible APK from Admin, so that I can obtain the intended release from the installation I manage.
5. As an IT administrator, I want the release version, stable versioned URL and checksum available with the download, so that I can identify and verify the artifact I distribute.
6. As an IT administrator, I want APK updates delivered on our rollout schedule, so that a web deployment does not unexpectedly replace the application used by a crew.
7. As a clinician, I want the Android application to use the familiar web interface, so that I do not need to learn a second documentation workflow.
8. As a clinician, I want the initial application view to be Mobile, so that I can start with the workflow intended for field use.
9. As an authorized user, I want the same Stationary, Review and Admin features available on Android, so that the wrapper does not introduce a separate feature or permission model.
10. As a user, I want agency appearance, language and presentation preferences to work consistently, so that Android remains part of the same product.
11. As a clinician, I want usable phone and tablet layouts, so that I can work on the supported devices supplied by IT.
12. As a clinician, I want Android navigation, the keyboard and orientation changes to preserve my work, so that normal device interactions do not discard documentation.
13. As an administrator, I want device setup handled by the existing unit/vehicle pairing process, so that connection setup and operational enrollment do not become separate administrative workflows.
14. As an administrator, I want to prepare the server address and public CA trust information centrally, so that installers do not need to enter technical settings on each device.
15. As an installer, I want one pairing scan to configure the connection and identify the intended unit, so that I can prepare a manually installed APK without opening Android Settings.
16. As an installer using one device, I want an importable representation of the same pairing information, so that I can complete setup when I cannot scan another screen.
17. As an installer, I want to confirm the organization, unit and installation identity before enrollment, so that a scan does not silently associate the wrong device.
18. As an administrator, I want pairing authorization to remain short-lived and single-use, so that an old or copied enrollment code cannot repeatedly register devices.
19. As a clinician, I want vehicle pairing retained when I sign out, so that the incoming crew does not need to enroll the ambulance device again.
20. As an administrator, I want the APK registration visible in the existing unit inventory, so that I can use the same revocation and reassignment controls.
21. As a clinician, I want reassignment to retain the attribution and recoverability of eligible pending work, so that moving a device does not rewrite report history or silently discard edits.
22. As an IT administrator, I want managed server settings supplied through the standard Android interface, so that I can configure OpenTriage without a vendor-specific application integration.
23. As an IT administrator, I want managed values protected from local changes, so that a pairing scan or manual setting cannot redirect a managed device away from its approved installation.
24. As an installer, I want conflicting or incomplete managed settings explained, so that I can correct provisioning without the app silently using another server.
25. As a clinician, I want to connect to the organization's internal-CA server after application pairing, so that manually installing the APK does not require separate device certificate configuration.
26. As an IT administrator, I want public CA trust material handled separately from private keys, so that application setup can be distributed without distributing server secrets.
27. As a deployment operator, I want to provision the server certificate chain and private key through a shell workflow, so that IT-delivered TLS material fits the existing hosting process.
28. As a deployment operator, I want certificate errors to identify a failed connection without bypassing verification, so that deployment problems can be corrected deliberately.
29. As a clinician, I want the existing personal sign-in and reauthentication workflows, so that packaging does not change who can access or author records.
30. As an administrator, I want existing agency boundaries and authorized agency switching preserved, so that a device wrapper does not broaden access.
31. As a clinician, I want camera and microphone capture to work through Android's permissions, so that I can continue using photo and audio notes.
32. As an authorized user, I want media playback, report downloads and signing to work over the configured connection, so that internal-CA support covers the complete workflow.
33. As a clinician, I want an already opened, unlocked report to remain editable during connection loss under the existing protected-storage rules, so that packaging preserves current offline capability.
34. As a clinician, I want pending changes to synchronize when connectivity returns while the app is active, so that I do not need to re-enter work.
35. As a clinician, I want assignments and pending synchronization refreshed when I return to the app, so that foreground work resumes promptly.
36. As a clinician, I want retained drafts to remain encrypted after the application process exits, so that reopening the application does not expose clinical content before authorized recovery.
37. As a clinician, I want an online recovery path after process restart, so that eligible retained work can be recovered under the existing identity and expiry rules.
38. As a clinician, I want clear storage and recovery status, so that I understand when offline editing is unavailable or retained work needs connectivity.
39. As an IT administrator, I want an in-place APK upgrade to retain provisioning, enrollment and eligible encrypted pending work, so that updating the application does not require starting over.
40. As an installation superadmin, I want a 90-day default APK upgrade grace period that I can configure, so that IT can coordinate deployment across the installation.
41. As an installation superadmin, I want that compatibility policy to apply to every agency on the server, so that shared API behavior has one supported rollout policy.
42. As an installation superadmin, I want the policy constrained by actual supported client versions, so that an administrative setting does not promise compatibility the server cannot provide.
43. As a clinician, I want an upgrade requirement displayed before starting new work, so that I can address it without silently losing existing work.
44. As a clinician, I want pending drafts recoverable through an upgrade, so that an old APK's retirement does not erase unsynchronized documentation.
45. As an IT administrator, I want installation-specific deployment instructions for Intune and our combined MDM, so that configuration and certificate delivery can be validated in each environment.
46. As an IT administrator, I want to distinguish an app capability from a missing MDM capability, so that I know which system requires a change before automatic setup will work.
47. As a deployment operator, I want release evidence from emulator and representative physical-device testing, so that browser tests alone are not presented as Android acceptance.
48. As a deployment operator, I want upgrade, internal-CA, enrollment and recovery failures detected before rollout, so that crews do not discover packaging regressions in service.
49. As a product maintainer, I want native device capabilities to fit behind stable integration boundaries, so that future Bluetooth work can reuse the clinical UI.

# Implementation Decisions

## Modules and interfaces

The following module boundaries organize the implementation work already agreed.
They are not separate applications or a requirement to create an abstraction for
every platform difference.

| Module | Responsibility | Small, independently testable interface |
| --- | --- | --- |
| Android runtime and shared UI | Bundle the shared web build; integrate lifecycle, navigation, permissions and platform capability checks | Expose platform capabilities and lifecycle events to the shared application; load a known bundled UI version. |
| Provisioning and unit enrollment | Resolve managed configuration; extend the existing scan/import, confirmation, enrollment, reassignment and revocation lifecycle | Preview and confirm a provisioning/enrollment intent; return authoritative connection and installation state; report conflicts without partially changing identity. |
| Trusted connection and authentication transport | Establish app-specific CA trust and route API, authentication, media and download traffic consistently | Perform bounded requests within the approved server context, manage credentials at the appropriate native boundary, and surface typed connection/authentication outcomes. |
| Release production and distribution | Produce and sign immutable APK releases; expose compatible release metadata and Admin downloads | Publish or resolve a verified release descriptor containing application identity, version, artifact location, digest and compatibility information. |
| Compatibility policy and upgrade recovery | Store installation-wide policy; evaluate a client version and deadline; gate new work while preserving recovery | Resolve policy and evaluate allowed, upgrade-advised or upgrade-required behavior using server-authoritative release information. |

MDM interoperability, protected storage and existing authentication are cross-cutting
acceptance concerns of these modules. Keep substantial behavior encapsulated
behind these boundaries and share application logic wherever the platform permits.

## Packaging and shared behavior

- Use Capacitor with the application's existing static web export bundled into
  the APK. Keep the API remote. A hosted website URL is not the production UI
  delivery mechanism for this package.
- Keep one UI source and shared business rules. Android adapters cover genuine
  platform differences; they do not fork clinical screens or authorization rules.
- Mobile is the initial mode. Retain normal preference behavior thereafter and
  keep every role-permitted mode accessible, including existing signing flows.
- Establish a stable application ID and release signing identity before distributing
  the first supported APK. Keep signing private material in the release secret
  process. APK signing keys and the server's HTTPS private key are different assets.
- Give every published APK an increasing Android version code and immutable release
  metadata. The same release bytes serve every installation and MDM target.
- Prevent the browser service-worker update mechanism from replacing or reloading
  the versioned APK UI. Preserve the browser application's existing update behavior.
- Validate Android Back behavior, safe areas, keyboard resizing, permission denial,
  rotation, background/foreground transitions and process recreation against the
  shared workflow. Do not silently reset active reports or presentation state.
- Follow the existing UI style guide. All new user-visible text, including setup,
  platform failures and upgrade notices, belongs in localization resources. Keep
  technical instructions compact and use tooltips or operator documentation where
  appropriate.

## Configuration, bootstrap and vehicle pairing

- Extend the existing operational-unit enrollment mechanism and inventory. Vehicle
  association means the existing unit registration; this milestone does not create
  another vehicle registry or a parallel enrollment authority.
- Preserve the existing five-minute, single-use enrollment authorization,
  installation-name and explicit-confirmation behavior. Pairing grants no clinician
  session, role or permission. Normal authentication follows enrollment.
- An unconfigured manually installed APK must support the combined scan/import
  flow before it can connect to the private server. The flow carries the intended
  connection and enough public trust information to authenticate the first HTTPS
  connection, as well as the existing scoped enrollment authorization.
- Treat import as an alternative entry into the same pairing process. It must
  not become a reusable enrollment credential or a separate configuration wizard.
- Define a versioned, bounded provisioning representation shared by these entry
  points. Validate HTTPS origins, supported schema versions, trust material,
  expected installation and agency, and enrollment expiry before committing state.
  Preserve the existing protection against exposing enrollment tokens in logs and
  ordinary URL access logs.
- The bootstrap must not depend on downloading its initial trust anchor over a
  connection that cannot yet be authenticated. Validate QR size and scanning
  reliability. If trust material is fetched separately, authenticate that fetch
  with trust information delivered through the administrator's pairing artifact.
  Do not solve bootstrap by accepting arbitrary certificates.
- Declare a documented Android managed-configuration schema and read it using the
  platform interface at startup, resume and configuration changes. This is the
  common contract for Intune and the combined Headwind/MDMesh integration.
- Managed connection values take precedence and are not editable locally. Reject
  a pairing intent that conflicts with managed values. Missing or invalid managed
  configuration must not silently unlock an existing managed connection or select
  an unrelated locally remembered server.
- Apply connection, trust and enrollment changes coherently. A failed or interrupted
  attempt must not leave a device appearing enrolled under the wrong connection.
  Preserve existing identity-transition locking, sign-out and same-user recovery
  semantics during reassignment.
- Isolate credentials and protected local records by their originating installation
  and agency context. A changed server URL must not receive another installation's
  credentials or pending clinical requests. Preserve eligible encrypted pending
  work and make any required recovery explicit.
- Normal APK upgrades preserve provisioning and installation identity. Clearing
  application data or uninstalling is a different lifecycle; document its effect
  on enrollment and unsynchronized local work without promising recovery of deleted
  device bytes.

## Internal CA and authentication transport

- Internal-CA support is part of the first release. Manual app pairing must be
  sufficient without installing a CA through Android Settings. Store supplied
  public CA trust information for OpenTriage's configured connection and implement
  the required native transport support.
- Retain normal chain, validity and hostname verification. Keep the configured
  origin and permitted destinations explicit, including redirect handling. Public
  CA deployments continue to work. A provisioning operation is an explicit trust
  decision; a failed connection cannot establish new trust by itself.
- Standard MDM certificate provisioning can remain available for managed devices.
  If the implementation opts into the device-installed CA store, document that
  this also includes manually installed CAs and validate the applicable device
  policy. That mechanism must not become a prerequisite for manual APK setup.
- Support certificate renewal and deliberate CA replacement without a customer-
  specific APK build. Validate overlap/rotation and the pairing recovery path when
  an old trust relationship is no longer usable. The exact automatic rotation
  protocol is an implementation decision to establish before rollout.
- Provision the server certificate chain and IT-delivered HTTPS private key through
  the existing operator shell/deployment process. Make the applicable public CA
  information available to Admin pairing. Private server or CA signing keys are
  not part of an APK, QR, setup file or public release descriptor.
- The bundled UI has a different origin from the hosted application. Existing
  Secure, HttpOnly, SameSite=Strict session and installation cookies, agency-host
  checks, CSRF checks and enrollment-origin binding require an explicit native
  integration. Setting an API base URL alone does not establish compatibility.
- Preserve server authorization, session expiry, revocation, shift checks, local
  sign-in, configured OIDC flows, reauthentication and authorized agency handoffs.
  Keep provider tokens and protected session credentials out of JavaScript-readable
  persistent configuration. Do not weaken browser protections for the wrapper.
- Apply the trusted connection consistently to authentication, ordinary API calls,
  enrollment, recovery, media upload/playback and report downloads. Direct resource
  URLs and browser navigation need coverage as well as ordinary fetch requests.
- OIDC redirects and external authentication surfaces require a validated return
  path to the APK. App-specific CA trust does not automatically configure an
  external browser's trust store or the identity provider's certificate chain.
  Preserve supported provider behavior and record deployment prerequisites rather
  than treating local-password success as proof of SSO acceptance.

## Offline, storage and lifecycle

- Retain the existing protected-storage contract: clinical working copies and
  queued changes are encrypted; readable report keys remain in memory only while
  unlocked; post-restart recovery is online and server-authorized.
- Preserve capability detection, storage-failure behavior, session and recovery
  deadlines, identity isolation, late-work handling and the prohibition on silently
  evicting unsynchronized work. Packaging does not extend those guarantees.
- Foreground operation resumes assignment refresh and pending synchronization.
  Background execution, screen-locked synchronization, push alerts and continuous
  device connections are not promised by this release.
- Validate IndexedDB, Web Crypto, Web Locks and persistence behavior in the actual
  Android runtime. A browser viewport test does not prove their behavior in an APK.
- Handle platform backups, diagnostics and temporary native media files consistently
  with the existing protection boundaries. Do not introduce durable plaintext
  clinical copies or export authentication credentials through Android backup.
- Preserve eligible encrypted state across supported in-place upgrades. Treat
  incompatible local data as retained recovery material instead of deleting or
  silently rewriting it. Test the oldest supported upgrade path.

## Release distribution and compatibility policy

- Produce release artifacts in a repeatable build/signing workflow. Admin serves
  or links to a prebuilt verified release; clicking Download APK does not compile
  a customer-specific application or expose signing material.
- Display a release compatible with the installation's server, not an unchecked
  global latest release. Supply a versioned URL and SHA-256 digest suitable for
  MDM import. Deployment decides how the artifact is hosted and made reachable.
- Keep ordinary authorized Admin download access distinct from installation-wide
  compatibility policy mutation, which belongs to Super-admin. Reuse existing
  authorization and auditing conventions for these operations.
- Store an installation-wide upgrade grace period with a default of 90 days.
  Agencies cannot override the shared server's compatibility policy. MDM may stage
  updates by device group independently.
- Publish server-supported client/protocol information independently of the
  administrative grace period. Validate policy changes against that information;
  a longer grace period cannot re-enable unsupported request or storage formats.
- Use server-authoritative version and deadline evaluation. As an implementation
  decision, tie deadlines to explicit release retirement/supersession information,
  with a compatible replacement available; do not let reinstalling an old APK or
  an unrelated server redeploy restart the grace period. Show the effective
  deadline and the impact of a policy change to Super-admin.
- At an upgrade deadline, gate starting new work and provide the compatible update
  route. Preserve pending encrypted work and its established recovery deadlines.
  Do not discard active documentation because of a version notice or silently
  weaken ordinary authorization/revocation checks to accommodate an old client.
- Establish compatibility tests for supported clients and upgrade/recovery formats.
  Verify that a current APK can recover retained work before retiring its predecessor.
  MDM can terminate an app during installation; operational rollout scheduling
  and process-loss tests must account for that independently of the UI notice.

## MDM support and persistence boundaries

- First-release managed-device support is Android Enterprise fully managed or
  dedicated devices, alongside manual APK installation. Android work-profile
  distribution is deferred. The standard configuration contract remains suitable
  for future use there.
- Validate direct APK distribution and managed configuration with Intune and the
  actual combined Headwind/MDMesh deployment. Document configuration names, types,
  precedence, certificate options and upgrade steps without vendor-specific logic
  in the clinical UI.
- Treat missing managed-configuration support in the combined MDM as separate work
  in its repository. An APK with a tested standard receiver is not proof that the
  MDM agent can supply those values.
- Intune currently documents direct APK configuration for fully managed/dedicated
  devices and requires configuration policies to be recreated/assigned for a new
  directly deployed APK version. Validate configuration continuity during upgrades
  and reflect the deployed Intune behavior in operator instructions.
- Persist the compatibility policy using the existing installation administration
  model and store provisioning state within the application's protected platform
  boundary. Extend existing enrollment contracts rather than introducing a new
  unit/device model. Exact database migrations, metadata contracts and package
  identifiers are implementation decisions; this PRD does not prescribe SQL or
  a speculative schema redesign.

# Testing Decisions

Good tests verify externally observable behavior and durable contracts rather
than mirroring implementation details. All five modules above receive appropriate
coverage. Reuse shared browser/API tests and add Android coverage where the runtime,
transport or operating system changes behavior.

## Representative coverage

| Area | Required evidence |
| --- | --- |
| Runtime and UI | Install and launch bundled assets; phone/tablet layouts; existing role-permitted modes; localization; Back, keyboard and rotation; permissions granted, denied and revoked; foreground refresh. |
| Provisioning and enrollment | One QR/import configures and pairs an initially unconfigured APK with an internal-CA server; explicit confirmation; existing five-minute expiry, single use and replay rejection; wrong agency/unit, malformed payload and interrupted setup; inventory, revoke and reassign. |
| Managed configuration | Standard restriction delivery, initial configuration, managed-value locking, conflicting QR, startup/resume changes, incomplete configuration and configuration continuity across APK updates. |
| TLS and transport | Public and private CA connections; invalid chain, wrong hostname and expired certificate rejection; authenticated first-connection bootstrap; CA renewal/replacement; no credential forwarding to unapproved origins; API, authentication, media and downloads all use the intended trust. |
| Authentication and isolation | Local and configured OIDC sign-in, reauthentication, logout, expiry, shift checks and agency handoff; installation identity survives clinician logout; reassignment locks prior work; cross-server/agency data and credential isolation. |
| Protected work | Offline continuation, reconnect synchronization, real process termination/relaunch, no readable retained clinical content before recovery, authorized online recovery, storage failure, session loss and late-work handling. |
| Release distribution | Repeatable Android build, release-signature verification, application/version identity, immutable artifact digest, correct Admin download authorization and compatible-release selection. |
| Compatibility and updates | Default/configured grace period, Super-admin-only mutation, cross-agency consistency, invalid policy rejection, deadline evaluation, new-work gating and in-place upgrade with retained provisioning and encrypted drafts. |

## Prior art and execution

- Extend the existing complete mobile journey and deployed static-build tests for
  common clinical behavior. Keep browser behavior covered while introducing native
  request and lifecycle adapters.
- Reuse the existing enrollment, reassignment, revocation and installation-session
  suites for the unit and clinician identity boundaries.
- Use the protected clinical-storage unit tests and recovery-transition browser
  tests as prior art for encrypted retention, reauthentication and pending work.
- Use the existing personal OIDC, session startup, agency-header and shift tests
  for authentication parity. Existing media and stationary accessibility coverage
  supplies shared photo/audio and layout expectations.
- Add Android build, native contract and emulator checks early enough to catch PR
  failures locally. Include representative configurations and failure paths rather
  than testing only a successful demo connection.
- Run `npm run check:ci` before an implementation PR, including its documented
  application, deployment, database and scale prerequisites. Integrate the new
  Android checks into an appropriate documented local and PR validation path.
- Perform physical-device acceptance on representative Android 13+ phone and
  tablet hardware, including current supported WebViews, camera/microphone,
  scanning, process loss and upgrades. The exact models remain a rollout input.
- Perform actual MDM acceptance in an Intune test deployment and the combined
  Headwind/MDMesh environment. Standard Android test tooling can establish the
  application contract, but cannot substitute for evidence from those deployments.

The first implementation slice should demonstrate manual install, combined vehicle
pairing to an internal-CA server, ordinary sign-in, offline editing, process
restart and authorized online recovery. Establish this connection and lifecycle
foundation before completing release automation and the full MDM matrix.

# Out of Scope

- A second clinical UI, native screen rewrite, Android-only permission model or
  unrelated web-interface redesign.
- Bluetooth discovery, pairing with medical equipment, measurement ingestion,
  vendor device protocols or continuous Bluetooth connections. Keep the native
  integration boundary extensible for that later work.
- Background/screen-locked synchronization, dispatch push alerts or new foreground
  services intended to keep the application continuously running.
- Offline sign-in, offline creation of new work, or offline recovery of retained
  report keys after process restart; preserve the existing operational limits.
- iOS packaging and initial Android work-profile or public app-store distribution.
- Intune-specific mobile application management SDK/app-protection integration;
  the agreed target is standard managed-device configuration.
- Per-customer APK builds, embedding customer private keys in APKs, and device
  client certificates or mutual TLS.
- Admin handling of TLS private-key material; the agreed server workflow uses
  shell/deployment tooling. Public CA information remains part of provisioning.
- Implementing missing Headwind/MDMesh agent features inside this repository,
  or building MDM fleet-management and kiosk-policy controls into OpenTriage.
- Silent changes to Android's global certificate store by an ordinary manually
  installed APK. Application-specific trust satisfies the manual pairing requirement.
- Unlimited backwards compatibility, arbitrary downgrades, and automatic live
  replacement of bundled application code from web deployments.

# Further Notes

## Evidence and interpretation

The current application already exports a static web build and has protected
offline storage, role-controlled modes, media capture, enrollment and session
transitions. Current code and runbooks also contain OIDC and agency handoff paths;
older README/PRD statements that those are wholly deferred are not a basis for
excluding them from packaging compatibility.

The module split, coherent configuration transitions, version metadata and trust
bootstrap details are implementation decisions inferred from the agreed behavior
and existing boundaries. They do not introduce a new clinical workflow. Exact
protocol shapes, QR encoding, release hosting, policy range/effective-time rules
and Android package/signing ownership must be made concrete during implementation.

The final pairing decision supersedes the earlier idea that manually installed
devices must configure their server URL or install an internal CA in Android
Settings. File import enters the same pairing workflow. MDM-driven OS trust remains
an optional managed-device deployment mechanism.

## Dependencies and material risks

- Application-specific runtime CA trust is substantive native work. It must cover
  the complete authenticated request surface, including cookies, redirects,
  media and downloads; a configuration-only Capacitor wrapper is insufficient.
- OIDC provider redirects, private-CA identity providers and authorized cross-host
  agency handoffs require technical validation. An external authentication browser
  may need trust provisioned by IT. Do not promise that app-local CA setup configures
  every external application; establish the deployment-compatible flow before
  claiming full feature parity.
- The referenced upstream MDMesh configuration contract and open integration issue
  identify a possible managed-app-configuration gap. The combined repository may
  already address it and must be inspected during its separate integration work.
- Headwind/MDMesh and Intune acceptance requires available test environments.
  Physical phone/tablet models and a release signing identity are still to be
  selected; they are implementation/rollout inputs, not requests to expand scope.
- The Admin download must resolve to an artifact reachable by the intended
  administrator/MDM. Private-server CA trust and authentication needed to obtain the
  APK itself are deployment concerns; the in-app pairing flow starts after install.
- Sharing an APK across installations does not share local sessions or draft
  stores with an existing browser installation. Existing enrollment and protected
  recovery boundaries continue to apply.

## References

- [Protected offline storage and recovery](https://github.com/open-triage/open-triage-epcr/blob/main/docs/protected-offline-clinical-storage.md).
- [Existing installation enrollment and reassignment](https://github.com/open-triage/open-triage-epcr/blob/main/docs/runbooks/installation-enrollment.md).
- [Personal OIDC sessions](https://github.com/open-triage/open-triage-epcr/blob/main/docs/runbooks/personal-oidc-sessions.md).
- [Kubernetes production deployment and TLS setup](https://github.com/open-triage/open-triage-epcr/blob/main/docs/runbooks/kubernetes-production.md).
- [UI style guide](https://github.com/open-triage/open-triage-epcr/blob/main/docs/design/ui-style-guide.md).
- [Local development and preflight prerequisites](https://github.com/open-triage/open-triage-epcr/blob/main/docs/runbooks/local-development.md).
- [Capacitor configuration](https://capacitorjs.com/docs/config), [Android support](https://capacitorjs.com/docs/android), and [native HTTP support](https://capacitorjs.com/docs/apis/http).
- [Android managed configurations](https://developer.android.com/work/managed-configurations) and [application network security configuration](https://developer.android.com/privacy-and-security/security-config).
- [Intune Android configuration](https://learn.microsoft.com/en-us/intune/app-management/configuration/configure-managed-android), [direct APK deployment](https://learn.microsoft.com/en-us/intune/app-management/deployment/add-lob-android), and [trusted certificate profiles](https://learn.microsoft.com/mem/intune/protect/certificates-trusted-root).
- [Headwind MDM](https://github.com/h-mdm/hmdm-server), [MDMesh](https://github.com/MDMesh-app/MDMesh), and [MDMesh managed-configuration integration issue](https://github.com/MDMesh-app/MDMesh/issues/96).

External platform behavior was checked during the design discussion. Recheck it
against the actual SDK, Android, WebView and MDM versions used for implementation
and deployment.

# Problem Statement

An installation may serve several independent ambulance agencies or several operational divisions of the same agency. Independent agencies need separate staff directories and clinical data. Related divisions need to share staff and permissions while retaining their own calls, reports, clinical configuration and settings.

Requiring a separate installation or duplicate account for each division makes administration and oversight harder. Combining divisions into one undifferentiated agency loses the configuration and record ownership needed for daily work. Installation administrators need a way to establish these boundaries, and clinicians must always know which agency they are working in.

# Solution

Support multiple agencies within one installation. An agency may be an independent root or a child of a root agency. A root and its direct children form an agency group, also called a family. They share identities and roles, while clinical records and configuration remain owned by each individual agency.

Give the installation owner and additional installation superadmins a Super-admin workspace for creating, configuring and disabling agencies. Reuse Agency Settings for setup, including regional settings, branding, limits and demographic identifiers. Allow a new agency to start with published form and validation definitions copied into its own configuration, or to complete clinical configuration later.

Resolve the sign-in agency from its registered hostname. Let authenticated users switch between agencies they can access, with safeguards for open reports, pending synchronization and stale browser tabs. Selecting a parent in Review combines the parent and its active children; selecting a child limits Review to that child. Existing permissions continue to govern which reports and identifying details a user can see.

# User Stories

1. As an installation owner, I want to create independent agencies in one installation, so that separate organizations can use the same deployment without sharing ordinary access.
2. As an installation administrator, I want to create child agencies under an active parent, so that operational divisions can share staff while keeping separate clinical workspaces.
3. As an installation administrator, I want to see agency names, groups, hostnames, status and active configurations, so that I can understand the installation's setup.
4. As an installation administrator, I want to open an agency's administration workspace from the agency list, so that I can finish its configuration.
5. As an installation administrator, I want to set language, regional format, time zone, branding, retention, authentication and media limits during creation, so that the agency starts with appropriate settings.
6. As an installation administrator, I want to select a published catalog and supply the agency's demographic identifiers, so that its clinical configuration has the required foundation.
7. As an installation administrator, I want to select a compatible published form and validation pair as a starting configuration, so that I can reuse established definitions.
8. As an installation administrator, I want starting definitions copied into the new agency with their own published identities, so that later changes can be managed independently.
9. As an installation administrator, I want an invalid starting configuration to reject the entire creation, so that I am not left with a partially configured agency.
10. As an installation administrator, I want to configure clinical definitions later, so that agency setup does not require an immediately available form and validation pair.
11. As an installation administrator, I want configuration choices to show where they are currently used, so that I can identify relevant starting versions.
12. As an installation administrator, I want to rename an agency, change its hostname or disable it, so that the directory reflects operational changes without deleting its history.
13. As an installation administrator, I want conflicting edits to require a reload, so that I do not silently overwrite another administrator's changes.
14. As an agency administrator, I want staff administration from a parent or child to use the same directory, so that I manage each staff member once for the group.
15. As a staff member, I want my assigned roles to apply across my agency group, so that I can work in its divisions with one account.
16. As an agency administrator, I want my family's username reservations to be independent of other families, so that another agency's account does not prevent ordinary username use in mine.
17. As an agency administrator, I want renamed usernames to remain reserved within the family, so that another account cannot assume an old identity.
18. As an installation operator, I want to create additional superadmins without replacing the owner, so that installation administration can be shared while accountability remains explicit.
19. As an installation administrator, I want my username reserved across the installation, so that sign-in at the portal and agency addresses remains unambiguous.
20. As an installation owner, I want ordinary agency administration to be unable to modify privileged installation accounts or reset their credentials, so that agency authority cannot take over installation authority.
21. As an installation owner, I want the existing nomination and acceptance workflow to transfer installation-wide ownership, so that succession does not require separate transfers for every agency.
22. As a staff member, I want my agency's hostname to select the correct family before checking my credentials, so that equal usernames in unrelated agencies cannot resolve to the wrong account.
23. As a staff member, I want authentication failures for an identically named account in another family to remain separate from my account limit, so that unrelated attempts do not consume my account's allowance.
24. As a clinician, I want to see and select only agencies available to my account, so that I can choose the correct workspace.
25. As a clinician, I want switching to require connectivity and completed synchronization of open work, so that changing agencies does not strand clinical changes.
26. As a clinician, I want agency switching to lock protected clinical storage and reload agency settings and workspaces, so that the previous agency's state cannot carry into my new workspace.
27. As a clinician using several tabs, I want commands from a stale agency tab rejected, so that they cannot execute in an agency selected elsewhere.
28. As an agency administrator, I want hostname changes and agency disablement to invalidate affected sessions, so that withdrawn access does not remain usable.
29. As an agency administrator, I want calls, units, reports, notes, forms, validation, settings and configuration history to remain agency-specific, so that shared staff do not erase agency ownership.
30. As a configuration author, I want import choices to include shared templates and my agency's publications, so that unrelated private agency exports are not exposed to me.
31. As a reviewer, I want selecting a parent to show its own and its active children's records, so that I can oversee the group in one workspace.
32. As a reviewer, I want selecting a child to show only that child's records, so that I can focus on a division.
33. As a reviewer, I want combined queues to identify each record's agency, so that I understand its operational context.
34. As a reviewer, I want actions on a child's record to use that child's configuration, outcome choices and audit context, so that group-level oversight respects local workflows.
35. As a reviewer, I want own-report, identifying-data and real versus synthetic restrictions preserved across group views, so that broader agency scope does not grant additional permissions.
36. As an analyst, I want queries and exports to follow the selected agency or group, so that results match the workspace I am reviewing.
37. As an analyst, I want configured metrics labeled by agency and evaluated against that agency's reports and definitions, so that different configurations do not silently mix.
38. As a deployment operator, I want agency addresses to serve both the application and its API on the same origin, so that browser sessions stay bound to the intended address.
39. As a deployment operator, I want explicit or wildcard agency host routing with authentication rate limits, so that agencies can share a deployment consistently.
40. As a developer, I want local agency subdomains and a separate landing host, so that I can exercise the hosted agency workflow locally.
41. As an installation operator, I want upgrades to preserve existing agencies and records and require fresh sign-in for hostname binding, so that the new access model has a clear transition.

# Implementation Decisions

## Agency lifecycle and starting configuration

- Encapsulate installation-wide agency listing, creation and updates behind the agency-management service. Require installation owner or superadmin authority for these operations.
- Represent groups using an optional parent agency. Allow one level of children, require an active root parent at creation and reject later parent changes.
- Expose agency listing and creation through GET and POST `/api/super-admin/agencies`, and updates through PUT `/api/super-admin/agencies/:id`.
- Return agency identity, parent and group identity, hostname, active status, revision and time zone. The directory also supplies the hostname suffix, eligible catalogs, published starting definitions, usage information and active configuration summaries.
- Creation accepts agency identity and demographic settings, a published catalog and optionally both starting form and validation versions. Reuse the shared Agency Settings validation and editor, including the time-zone selector and English/Swedish interface strings.
- Copy, publish and activate compatible starting definitions within the agency-creation transaction. Preserve source and destination identities in the creation audit event. Do not change the administrator's current browser agency during this operation.
- Without a starting pair, create the agency without an active clinical configuration. Show eligible published catalogs immediately in its editors. Prefer actively used catalogs in the installation-wide selector and exclude orphaned agency releases.
- Update name, hostname and active state using an expected revision. Enforce hostname uniqueness and preserve creation/update audit history. Disabling a parent withdraws access to its children; the installation owner's home agency must remain active.

## Shared identities and installation authority

- Keep staff accounts, roles and role assignments at the family root. Resolve staff, credential, session and role administration through that shared directory when the selected workspace is a child.
- Compute live access and capabilities from current account state, family membership, agency status, role assignments and installation authority. Durable user-to-agency relationships preserve historical references; they do not independently grant access.
- Scope ordinary username reservations to the family and retain prior names. Reserve owner and superadmin names globally, including their reserved old names. Serialize conflicting reservations so concurrent provisioning cannot produce ambiguous identities.
- Resolve the agency before credential lookup and reject ambiguous internal lookups. The general portal permits installation administrators; ordinary users sign in through an agency address. Account throttling follows the resolved identity, shared across its family and separate from equal usernames elsewhere.
- Maintain one accountable installation owner and a separate additional-superadmin registry. Provision additional superadmins through the audited operator identity CLI, retaining the temporary-password change workflow.
- Protect owner and superadmin account details, roles and credential resets from ordinary user-administration operations. Administrator and Demo role assignment remains privileged and requires recent reauthentication.
- Keep ownership nomination and acceptance in the owner's home directory, with installation-wide effect. Retain historical actor relationships after transfer.

## Hostname-bound login and agency switching

- Resolve registered agency hostnames and reject inactive or unknown agency addresses. Expand short subdomains using the configured agency base domain, falling back to the web origin's hostname. Accept full custom hostnames; reject schemes, paths, ports and wildcards as agency hostname values.
- Include installation authority flags, the home agency, accessible agencies and current group identity in the session contract. Store the selected agency and browser origin with the session and recheck access on requests.
- Switch through POST `/api/sessions/agency/:id`, returning the updated session. Reject inaccessible targets and concurrent conflicting switches, audit the transition and never extend expiry when applying the target agency's session-duration limit.
- Bind browser requests to the tab's selected agency using `x-organization-id`. Reject a mismatch with the session's selected agency rather than accepting the command in the new context.
- Require online switching, no open or opening report and no pending report synchronization. Confirm discarding unsaved editor changes through the existing editor safeguard. Lock protected storage, clear runtime report and configuration state, preserve the session's CSRF token and reload the workspace after switching.
- Revoke affected sessions when hostnames change or access is disabled. Origin authorization respects agency and parent status. Preserve the original Host at the edge; do not derive agency selection from forwarded-host headers.

## Agency-isolated clinical data and configuration

- Retain agency ownership for calls, units, reports, media and notes, catalogs, forms, validation, settings and configuration history. Adapt user and audit references to shared family identities without moving clinical records into the parent.
- Keep ordinary configuration reads and mutations scoped to the selected agency. Installation-authorized starting configuration reuse is an explicit copy operation.
- Store exported publications in agency-specific directories. Import discovery exposes the selected agency's publications and shared installation templates. Exclude legacy unscoped local exports from tenant pickers; operators can re-export the appropriate versions into scoped storage.

## Parent-group Review and analytics

- Use one shared Review scope resolver for the selected agency and its accessible direct children. A child selection has only that child's scope. Installation administrators use the same selected-group boundary.
- Apply this scope to queues, attention summaries, analytics sources, report populations and exports, preserving existing report visibility, identifying-data and dataset checks.
- Resolve a targeted report or Review item back to its owning agency before reading agency-specific configuration or performing an action. Keep assignment, discussion, progress, media and audit behavior attached to the owning agency.
- Include agency identity in queue items and display it in combined views. Allow the outcomes endpoint to receive the selected item and dataset so that it returns that record's agency-specific choices.
- Load configured metric and rule libraries per agency, qualify their labels with agency names and evaluate each library against reports belonging to that agency. Preserve existing query limits and export protections.

## Hosting and migration requirements

- Use same-origin browser API requests for hosted agency addresses and host-only authentication cookies. Route the API prefix to the API service and the application to the web service for the primary web host and configured agency hosts.
- Support explicit agency hosts or wildcard routing in Helm, include these hosts in authentication rate limiting and require appropriate TLS configuration. Keep the public landing host configurable independently of agency application hosts.
- Support local agency subdomains through the development/static edge, forwarding API traffic to a fixed upstream while preserving Host and removing incoming forwarded headers. Serve the public landing page separately from the agency application and its service worker.
- Extend the database with parent/status/hostname/revision information, shared user references, selected-agency and origin session fields, append-only agency events, family username reservations and installation-superadmin identity records.
- Preserve pre-existing agencies as independent roots and retain existing records. Enforce singleton installation ownership; installations with multiple legacy owners require operator reconciliation. Revoke pre-upgrade sessions once because they lack the new hostname binding.
- Apply changes through the existing forward-only migration runner. DNS, ingress and certificate provisioning remain operator responsibilities; creating an agency does not provision infrastructure.

# Testing Decisions

Good tests verify externally observable behavior and access boundaries rather than implementation details. Cover all six modules, using the existing service tests, PostgreSQL integration harness, browser tests and deployment checks as prior art.

| Module | Required behavioral coverage | Existing test approach |
| --- | --- | --- |
| Agency lifecycle and starting configuration | Valid and invalid parent/hostname input; settings validation; compatible published copies; atomic rollback; configuration usage; conflicting revisions; disablement | Organization and Agency Settings service tests, canonical-package and form-publication tests, real PostgreSQL integration and agency-management browser scenarios |
| Shared identities and installation authority | Shared staff and roles across a family; isolation between families; equal usernames; retained and global reservations; concurrent provisioning; privileged account protection; CLI superadmin creation; ownership transfer | Account, provisioning, role and session-administration tests plus PostgreSQL integration under the restricted API role |
| Login and switching | Hostname selection; origin binding; disabled and unknown hosts; accessible agency lists; stale-tab rejection; per-identity throttling; expiry and revocation; open-work safeguards and refreshed workspace state | Session and organization tests, browser request tests, PostgreSQL integration and browser agency-selector/local-subdomain scenarios |
| Clinical and configuration isolation | Agency-private definitions and imports; shared templates; family clinicians acting in child agencies; correct report and note attribution; no unrelated-family access | Canonical-package, draft-report and form-publication tests plus PostgreSQL integration |
| Review and analytics | Parent aggregation; child-only and unrelated-family boundaries; own-report and identifying restrictions; child-specific actions and outcomes; configured definitions evaluated per agency; correctly scoped queries and exports | Existing Review, attention, workload, handoff, discussion, analysis, metric-library and analytics-source test suites, with PostgreSQL parent/child scenarios |
| Hosting and migrations | Same-origin API URLs; local routing and cookie isolation; explicit/wildcard ingress hosts; rate-limit coverage; TLS deployment validation; populated-installation upgrades and ownership preservation | Browser API and local-routing tests, local browser smoke coverage, Helm/deployment tests and the temporary-database migration integration harness |

Use a disposable database for integration coverage, apply the migration history and execute application operations with the restricted API role. Exercise operator-only bootstrap and identity actions separately. Existing test cases provide a starting point; their presence alone does not establish that all acceptance cases have passed.

# Out of Scope

- More than one level of child agencies, multiple parents or arbitrary cross-family staff membership.
- Reparenting existing agencies, transferring historical clinical data between agencies or destructive agency deletion.
- Installation-wide Review or analytics spanning unrelated families in one selection.
- Automatically synchronizing later configuration changes between agencies after copying starting definitions.
- Automatic DNS registration, certificate issuance or infrastructure provisioning during agency creation.
- Offline agency switching or switching while clinical work is open or awaiting synchronization.
- Self-service creation of installation superadmins through ordinary agency administration.
- New analytics chart types, new clinical metric definitions or changes to existing identifying-data permissions.
- New external identity providers, MFA or unrelated administration and clinical workflow redesigns.

# Further Notes

“Agency” is the user-facing term; existing contracts and database structures also use “organization.” “Agency group” and “family” describe the root and its direct children. Shared staff membership does not imply shared clinical configuration or record ownership.

This PRD extends the agency boundaries of the Users and Roles, Admin Controls, Review and Unified Analytics requirements. Their existing lifecycle, clinical, privacy and configuration semantics continue to apply unless explicitly changed here.

Initial agency setup still depends on an available published catalog. An agency configured later is not clinically ready until a compatible form and validation bundle is activated. Hostname availability depends on operator-managed DNS, routing and TLS. Private exports must not be placed among shared installation templates.

Acceptance includes both browser behavior and enforcement under the restricted database role. Test execution and operational readiness should be recorded with validation evidence; this document does not assert a completed test run or production rollout.

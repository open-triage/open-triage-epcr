# Multiple agencies in one installation

The installation has one owner and may have additional superadmins. These accounts can administer every active agency and
create or configure agencies under **Admin → Super-admin**. Ordinary administrators
manage staff and settings within their own agency group.

## Agency groups

Create an agency without a parent for an independent agency. Create it with a
parent for an operational division, resource type, or other agency that shares
staff with that agency. Parent groups have one level of children.

- Accounts and role assignments belong to the parent. Staff administration from a
  child edits this shared directory; roles apply across the entire group.
- Clinical records, calls, units, catalogs, forms, validation, settings and
  configuration history belong to their individual agency.
- Selecting the parent in Review combines the parent and its active children.
  Selecting a child shows that child's records. Existing own-report and
  identifying-data permissions still apply. Actions on a child record use its
  forms, workflow options and audit history.
- Independent agency groups cannot access each other's records or configuration.
  The installation owner is the explicit exception. Even the owner's Review view
  is limited to the currently selected agency/group.

Use the agency selector in the application header, or **Open admin** in the
super-admin list. Synchronize and close open reports before switching. Switching
locks clinical storage and reloads workspaces; stale browser tabs must sign in
again before sending commands in another agency.

A parent cannot be changed after creation. Moving historical patient data between
agencies requires a separate migration. Disable an agency to withdraw access;
there is no destructive agency deletion. Disabling a parent also withdraws access
to its children. Owners and superadmins have installation identities without a
home agency. They can sign in and manage agencies even when no agencies are active.
The selected agency is session context, not account membership. Ownership nominations
can be made from an agency's user directory and transfer authority over the entire
installation; acceptance converts the successor to an installation account. Existing
historical user references remain intact. Only one nomination may be pending across
the installation.

## Set up a new agency

1. In **Super-admin**, select **New agency**. This uses the same Agency Settings
   editor as ordinary configuration, with agency name, parent, subdomain and
   starting configuration selectors added. Set language, regional format, timezone
   from the dropdown, retention and login limits, media limits, branding and
   NEMSIS demographic identifiers before saving.
2. Optionally choose both a **Starting form** and **Starting validation rules**.
   The choices are published versions bound to the selected published catalog,
   with notes identifying agencies that currently activate each version or its
   starting copy. Creation copies the definitions into the new agency, publishes
   them with new identities and activates them in the same transaction. An
   incompatible pair rejects creation without leaving a partial agency.
   Active catalogs appear first. Published agency catalogs are available to the
   installation owner; orphaned releases from deleted agencies are excluded.
3. Select **Open admin** for the new agency. Its published catalog is immediately
   available in the configuration editors.
4. Import or edit its own form and validation definitions, publish them and
   activate a compatible configuration bundle using the existing Admin editors.
   Agencies created with **Configure later** start without an active clinical
   configuration. The super-admin agency list shows each agency's active catalog,
   form and validation rules.
5. Configure units and adjust agency settings as needed. Create staff and assign roles through the
   shared parent directory. Independent agencies each have their own directory.

Bundled files in `defines/catalog`, `defines/forms` and `defines/validation` are
shared installation templates. New publications are written beneath each type's
`local/<agency UUID>/` directory. The import picker exposes only that agency's
publications and the shared templates. Legacy files directly under `local/` stay
on disk but are excluded from tenant import pickers; re-export the appropriate
published versions to create scoped copies. Do not place private agency exports
in a shared template directory.

## Agency subdomains

Configure the exact hostname, for example `test.opentriage.org`, in Super-admin.
Enter only the subdomain, such as `test`, in the **Subdomain** field. The full
hostname appears underneath, and editing an agency shows the short value again. Short hostnames use `AGENCY_BASE_DOMAIN` when configured;
otherwise they use the hostname from `WEB_ORIGIN`. For example, with
`AGENCY_BASE_DOMAIN=opentriage.org`, `test` becomes `test.opentriage.org`. The
editor shows this suffix. Existing custom domains outside this suffix retain
their full hostname when edited. IP-based portal
addresses need an explicit base domain to support short hostnames. Unregistered
hostnames cannot select an agency; the configured `WEB_ORIGIN` remains the general
installation sign-in address. Sessions are bound to the browser origin where they
were created, and changing a hostname revokes affected sessions.

For hosted deployments, build the web image with
`--build-arg NEXT_PUBLIC_API_URL=same-origin`. This keeps browser API requests and
host-only authentication cookies on the agency's own origin. Rebuild the web image
when changing this build argument.

Configure DNS, ingress and certificates separately. For the Helm chart:

```yaml
ingress:
  agencyHosts:
    - "*.opentriage.org"
  tls:
    - secretName: agency-wildcard-tls
      hosts:
        - "*.opentriage.org"
```

A list of exact hostnames works as well. The chart routes `/api` to the API and `/`
to the web app for the primary web host and every agency host. It includes the
agency hosts in the authentication rate-limit ingress. Preserve the original Host
header, configure the existing trusted-proxy setting for TLS termination, and use
HTTPS with certificates covering every agency hostname. A wildcard certificate
covers one subdomain level. Creating an agency does not provision DNS or TLS.

Local development serves the landing page at `http://localhost:3000` and the
demo agency at `http://demo.localhost:3000`. Other agencies use their configured
subdomain, such as `http://test.localhost:3000`. See
[local agency subdomains](local-development.md#local-agency-subdomains).

## Upgrade and verification

Apply repository migrations using the normal migration runner. Migration
`20261012101529_multi_organization_access.sql` preserves existing agencies and
records as independent roots and requires a single installation owner. If legacy
data contains multiple owner rows, reconcile ownership before applying it; the
migration deliberately refuses to choose an owner. Existing sessions are revoked
once during this upgrade to establish hostname bindings on fresh sign-in.

The regression test creates and removes its own temporary database, applies the
complete migration history, then exercises agency setup, shared roles, published
forms, parent review queues, child record actions, hostname binding, revocation
and ownership transfer under the restricted API role:

```sh
npm run build -w @open-triage/api
node --env-file=.env.local --test apps/api/tests/multi-organization-postgres.integration.test.mjs
```

Use a local PostgreSQL account with permission to create temporary databases for
this test. The test does not create agencies in the normal development database.

## Username scope and superadmins

A root agency and its children share user identities and username reservations.
Independent families may use identical usernames. Login resolves the agency
hostname before selecting an account; it never tries passwords against accounts
from other families. Renamed usernames remain reserved within their family.

Owner and superadmin usernames are globally reserved and work at the main-domain
login as well as agency addresses. Create additional superadmins through the
[operator identity CLI](identity-recovery.md#additional-superadmins).

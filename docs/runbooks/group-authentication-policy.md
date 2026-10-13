# Group authentication policy migration

Authentication owns maximum session duration, temporary-password lifetime and
login attempt limits for a root agency and all its children. Agency Settings
retains its historical columns for compatibility; changing those columns through
the old API is rejected. New authentication policy changes require the existing
five-minute personal password reauthentication and append an attributable event.

The migration adopts existing root duration and attempt limits only when every
existing child agrees. It stops and names a conflicting group instead of choosing
values silently. Before upgrade, an installation operator must run the read-only conflict preflight
(`npm run preflight:authentication -w @open-triage/database`) described in
[the staged rollout runbook](production-workflow-rollout.md). It exits 2 and lists
conflicting immutable agency IDs before the migration can modify policy. The
following SQL is also available for manual inventory:

```sql
select app_identity.organization_group(agency.id) as group_id, agency.id, agency.name,
       agency.shift_session_duration_hours, settings.authentication_account_attempt_limit,
       settings.authentication_network_attempt_limit
from app_identity.organization agency
left join app_identity.agency_settings settings on settings.organization_id=agency.id
order by group_id, agency.id;
```

For each conflicting group, obtain an explicit administrator decision and record
the old values, chosen common values, approver and reason in the installation
change record. The conservative choice is the smallest duration and attempt
limits among members. A higher value requires an explicit decision that it weakens
that member's current policy. In one database transaction, update the root and
all child legacy duration/limit values to the approved common values using the
listed immutable IDs. Ensure missing agency_settings rows are created before
alignment. Rerun the inventory, verify agreement, then retry the migration.
The migration itself never resets throttle counters or existing credentials.

Existing temporary-password expiry timestamps remain unchanged. Until an
administrator saves a group override, newly issued temporary passwords use the
configured installation lifetime, preserving custom installation defaults.
New session issuance and password-change replacement sessions use the group
maximum. Existing session expiry timestamps remain fixed; agency switching can
only shorten expiry. Account throttling retains the immutable application-user
key across sibling agencies. Network throttling is shared within the root group;
installation and ingress protection continue independently.

Installation accounts retain their separate local credentials, operator password
recovery and portal access. This slice adds no SSO mode or alternative clinical
identity stack.

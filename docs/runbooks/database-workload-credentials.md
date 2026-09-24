# Database workload credentials

Every database-backed workload authenticates as its own installation-specific
PostgreSQL `LOGIN`. Never reuse a connection string between workloads. Passwords
and connection strings live only in the secret manager and Kubernetes Secrets;
do not put them in Helm values, shell history, tickets, logs, or rotation
evidence.

## Contracts

| Workload | Portable role | Allowed contract | Kubernetes Secret |
| --- | --- | --- | --- |
| API | `open_triage_api_runtime` | Runtime application schemas; no `analytics_private` or `operations`; no DDL or role/grant authority | `open-triage-api-database` |
| Database preparation | installation migration owner | Forward-only schema and disposable-demo fixture preparation; present only in the explicit pre-rollout Job | `open-triage-migration-database` |
| Analytics projector | `open_triage_analytics_projector` | Projection queue, private projection tables, and the identified signed source needed to build the documented analytical contracts | `open-triage-analytics-projector-database` |
| Analytics health | `open_triage_analytics_health` | Aggregate `operations.projection_health` view only | `open-triage-analytics-health-database` |
| Retention/purge | `open_triage_retention` | Approved retention functions and synthetic purge function | `open-triage-retention-database` |
| Operational audit writer | `open_triage_operational_audit_writer` | Execute the metadata-only `operations.record_query_audit` function; no source-table reads | `open-triage-operational-audit-database` |

The portable roles are `NOLOGIN`, non-superuser, non-`CREATEROLE`, and
non-`CREATEDB`. Create random, installation-specific login names through the
database identity/secret manager, grant each exactly one portable role, and set
the connection's startup role to that portable role. The migration login is the
exception: it is the installation's object owner and is not granted or mounted
to any long-lived workload. Do not grant a runtime login membership in the
migration owner.

The operational audit Secret is consumed by the separately deployed analyst
query gateway, not by an OpenTriage chart pod. Keeping its value in the chart's
workload-specific values contract prevents an operator from substituting an API
or migration Secret when that gateway is installed.

## Rotation with bounded overlap

1. Create a new random login for only the workload being rotated, grant its one
   approved role, and record a credential identifier—not the login password or
   connection string—in the change evidence.
2. Create a new version of that workload's Kubernetes Secret with the new
   connection string. Do not edit another workload Secret and do not change the
   old login yet.
3. Roll only the affected Deployment, CronJob, or external gateway. For the
   migration credential, update the Secret between releases and confirm no
   database-preparation Job is running before rotation.
4. Verify readiness or run one successful scheduled Job, and confirm new
   connections use the new credential identifier.
5. Allow at most 24 hours of overlap for connection drain (normally one rollout
   window), then revoke login from and drop the old principal. Retain only
   timestamps, credential identifiers, and verification results.
6. Run the PostgreSQL privilege integration suite after provisioning or grant
   changes. Treat any successful out-of-contract query or DDL statement as a
   security incident and roll back the grant change.

Rotate service credentials within 30 days and immediately after suspected
exposure. Rotation never requires disclosing either old or new secret values.

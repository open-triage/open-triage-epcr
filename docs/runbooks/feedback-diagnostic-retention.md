# Feedback diagnostic retention

Sanitized feedback diagnostics are installation-local troubleshooting data. Run
this operation regularly to remove them after the submission has continuously
remained `resolved`, `declined`, or `duplicate` for at least 30 days. The
operation never deletes or rewrites the original submission, attribution,
current review projection, opaque reference, or append-only review events.

## One-time operator setup

Apply the normal forward-only migrations. PostgreSQL creates the non-login
`open_triage_feedback_retention` role with execute permission on one fixed,
bounded function and no direct table access. Create a dedicated login in the
installation database and grant only that role:

```sql
create role open_triage_feedback_retention_login login password '<secret>' noinherit;
grant open_triage_feedback_retention to open_triage_feedback_retention_login;
```

Store the password in the installation secret manager. Do not reuse an
application, reviewer, migration-owner, or superuser credential.

## Run bounded cleanup

Export the dedicated connection only for the invocation. A batch may contain
1–1,000 diagnostics and a run may contain 1–100 batches. Defaults are 100 rows
and 10 batches:

```sh
export FEEDBACK_RETENTION_DATABASE_URL='postgresql://open_triage_feedback_retention_login:...@localhost/open_triage'
npm run feedback:expire-diagnostics -w @open-triage/database -- \
  --batch-size 100 --max-batches 10
unset FEEDBACK_RETENTION_DATABASE_URL
```

The command prints counts only, for example:

```json
{"batches":2,"deleted":137,"remainingEligible":0,"batchSize":100,"maxBatches":10}
```

`remainingEligible` is capped at one batch. A nonzero value means the bounded
run stopped before all currently eligible rows were processed; rerun it. No
reference, description, diagnostic payload, user identity, or clinical value is
written to command output or application logs.

Each batch is its own transaction. Concurrent runs use `SKIP LOCKED`, and an
interrupted or failed batch rolls back completely. It is safe to rerun the same
command: already-cleaned, open, non-terminal, and recently terminal submissions
are not selected. Investigate a nonzero exit using PostgreSQL's ordinary
connection and migration logs, correct the operational fault, and rerun; never
edit migration history or delete diagnostic rows manually.

Deleting diagnostics is irreversible. Reopening a cleaned submission through
the normal review workflow changes only its current projection and appends a
review event. Its diagnostics remain unavailable and are not reconstructed.

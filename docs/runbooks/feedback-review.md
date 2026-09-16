# Read-only feedback review

This runbook is the supported internal path for listing and inspecting feedback.
It does not add a user-facing feedback inbox. A human makes every final review
decision. Issue creation, branch creation, pull requests, and implementation
each require separate explicit instructions; none is implied by a feedback
status, duplicate relationship, or downstream-work link.

## Reviewer setup

Apply the normal forward-only migrations first. PostgreSQL creates
`open_triage_feedback_reviewer` as a non-login role with only schema usage and
execution rights on the fixed `feedback.review_queue` and
`feedback.review_detail` functions. It has no direct table or sequence access.

An installation operator should create a dedicated login, store its password in
the installation's secret manager, and grant it membership in the non-login role:

```sql
create role open_triage_feedback_review_login login password '<secret>' noinherit;
grant open_triage_feedback_reviewer to open_triage_feedback_review_login;
```

Do not reuse an application, migration-owner, or superuser credential. Export the
dedicated connection URI only for the command invocation:

```sh
export FEEDBACK_REVIEW_DATABASE_URL='postgresql://open_triage_feedback_review_login:...@localhost/open_triage'
```

The CLI starts a read-only transaction and assumes the non-login reviewer role.
It accepts only the documented commands and options; there is no SQL option.

### Local and public-demo context wrapper

The repository wrapper can resolve the selected installation without placing a
connection URI on the command line. For `local`, it prefers an already supplied
`FEEDBACK_REVIEW_DATABASE_URL` and otherwise reads `DATABASE_URL` from the root
`.env.local`. For `public-demo`, it first requires the exact Kubernetes context
`do-ams3-k8s-open-triage-demo`, then reads only
`FEEDBACK_REVIEW_DATABASE_URL` from the cluster-owned
`open-triage-feedback-reviewer` Secret in the `open-triage` namespace.

Provision the public-demo login using the SQL above, then create the dedicated
Secret outside Helm. Do not reuse or add this key to `open-triage-database`:

```sh
kubectl create secret generic open-triage-feedback-reviewer \
  --namespace open-triage \
  --from-literal=FEEDBACK_REVIEW_DATABASE_URL='<dedicated-reviewer-uri>'
```

The wrapper passes the URI only in the child process environment and supports
the complete guarded CLI workflow:

```sh
npm run feedback:review:context -w @open-triage/database -- \
  --instance public-demo list --status new --limit 100
npm run feedback:review:context -w @open-triage/database -- \
  --instance public-demo list-open
npm run feedback:review:context -w @open-triage/database -- \
  --instance public-demo show --reference J7M4Q2K6X5PN
```

The same wrapper supports `propose`, `dry-run`, `apply`, `bulk-dry-run`, and
confirmed `bulk-apply`. Their human approval, expected-version, provenance, and
bulk-confirmation requirements remain unchanged. The wrapper does not weaken or
bypass validation performed by the underlying CLI.

## List the queue safely

Use `list-open` for the normal review workflow. It fetches `new`, `triaged`,
`planned`, and `in_progress`, follows every opaque cursor internally, and returns
items grouped by status with counts and a total:

```sh
npm run feedback:review -w @open-triage/database -- list-open
```

It accepts the shared `--type`, `--priority`, `--organization`,
`--created-from`, and `--created-before` filters. It intentionally does not
accept `--status`, `--cursor`, or `--limit` because it owns complete open-queue
pagination.

The default page contains at most 25 records. Pages are ordered by creation time
and the database-local unique key, newest first. Follow `nextCursor` exactly; do
not edit or decode it.

```sh
npm run feedback:review -w @open-triage/database -- list
npm run feedback:review -w @open-triage/database -- list \
  --status new --type bug --priority unassigned --limit 50
npm run feedback:review -w @open-triage/database -- list \
  --organization 4f4eaaf0-3ad8-4abe-980f-42aeb329ae10 \
  --created-from 2026-09-01T00:00:00Z \
  --created-before 2026-10-01T00:00:00Z
npm run feedback:review -w @open-triage/database -- list --cursor '<nextCursor>'
```

Supported status values are `new`, `triaged`, `planned`, `in_progress`,
`resolved`, `declined`, and `duplicate`. Types are `bug` and `feature`.
Priorities are `low`, `normal`, `high`, `urgent`, and `unassigned`. Timestamps
must be RFC 3339 values with a timezone. The maximum page size is 100.

An invalid cursor is rejected before a database query. Because the cursor fixes
the last `(created_at, id)` boundary, newly submitted records do not shift or
duplicate records in later pages.

## Inspect one item

Use only the opaque reference returned by the queue or supplied by the submitter:

```sh
npm run feedback:review -w @open-triage/database -- show --reference J7M4Q2K6X5PN
```

The result contains the immutable submission, its remaining sanitized diagnostic
record when one exists, and available append-only review history. Diagnostics
that were unavailable or removed by retention appear as `null`; they cannot be
restored by this workflow. A missing reference returns only
`Feedback submission not found`, and operational database errors are reduced to
`Feedback review command failed` so database internals are not exposed.

## Propose, verify, and approve triage

`propose` packages a suggested decision without recording it. It reads the
latest item and includes its `expectedVersion`; it does not invoke an AI model.
AI-assisted proposals identify the model and the human-started review run, but
must never include prompts or hidden reasoning:

```sh
npm run feedback:review -w @open-triage/database -- propose \
  --reference J7M4Q2K6X5PN --status triaged --priority high \
  --summary 'Refresh fails after reconnect' \
  --note 'Reproduced from the sanitized request-failure trail.' \
  --reviewer-type ai-assisted --model gpt-5 --review-run review-20260916-01
```

The human reviewer accepts, rejects, or edits that proposal. Before recording,
`dry-run` validates every explicit decision input and confirms that the version
has not changed. Its transaction is database-enforced read-only:

```sh
npm run feedback:review -w @open-triage/database -- dry-run \
  --reference J7M4Q2K6X5PN --expected-version 0 \
  --status triaged --priority high --summary 'Refresh fails after reconnect' \
  --note 'Approved after inspecting sanitized evidence.' \
  --reviewer-type ai-assisted --model gpt-5 --review-run review-20260916-01 \
  --human-reviewer maintainer@example.invalid
```

Only `apply` records the already approved decision; it uses the same explicit
arguments as `dry-run`. PostgreSQL locks the submission, rejects a stale
`expectedVersion`, appends exactly one immutable event, and updates the current
projection atomically. A human-authored correction uses `--reviewer-type human`
and omits `--model` and `--review-run`.

```sh
npm run feedback:review -w @open-triage/database -- apply \
  --reference J7M4Q2K6X5PN --expected-version 0 \
  --status triaged --priority high --summary 'Refresh fails after reconnect' \
  --note 'Approved after inspecting sanitized evidence.' \
  --reviewer-type ai-assisted --model gpt-5 --review-run review-20260916-01 \
  --human-reviewer maintainer@example.invalid
```

## Canonical duplicates and downstream work

Marking an item `duplicate` requires another existing feedback submission as
the canonical target. Self-reference, a missing target, and supplying a target
for any other status are rejected by both the CLI and PostgreSQL:

```sh
npm run feedback:review -w @open-triage/database -- apply \
  --reference J7M4Q2K6X5PN --expected-version 1 \
  --status duplicate --duplicate-of T7M4Q2K6X5PA \
  --priority normal --note 'Confirmed as the same report.' \
  --human-reviewer maintainer@example.invalid
```

After a human separately chooses or creates downstream work, an HTTPS issue or
pull-request URL may be recorded with `--external-kind issue|pull-request` and
`--external-url`. This command records only the link in an immutable review
event and the current projection. It does not create or modify the linked issue
or pull request, contact its hosting service, create a branch, open a pull
request, or implement anything.

## Guarded bulk review

Use `bulk-dry-run` first with one to 100 unique `REFERENCE:VERSION` items. It
uses a database-enforced read-only transaction and cannot record decisions:

```sh
npm run feedback:review -w @open-triage/database -- bulk-dry-run \
  --item J7M4Q2K6X5PN:1 --item T7M4Q2K6X5PA:0 \
  --status planned --priority high --note 'Approved release group.' \
  --human-reviewer maintainer@example.invalid
```

`bulk-apply` rejects the same command unless the additional `--confirm-bulk`
flag is present. Confirmed batches have documented partial success: every item
runs behind its own savepoint, known missing/stale/validation failures are
reported per reference, and successful items commit. An unexpected database or
connection failure rolls back the entire still-open batch. Reinspect failures
and their current versions before a separate retry; never blindly replay the
whole batch.

```sh
npm run feedback:review -w @open-triage/database -- bulk-apply \
  --item J7M4Q2K6X5PN:1 --item T7M4Q2K6X5PA:0 \
  --status planned --priority high --note 'Approved release group.' \
  --human-reviewer maintainer@example.invalid --confirm-bulk
```

JSON is the default output for later AI-assisted sessions. `--format text`
pretty-prints the same bounded data. List, show, proposal, and dry-run commands
make no database changes. No review command invokes a model, creates GitHub
issues, branches, pull requests, code changes, or any other external action.
Clear the environment variable after the review session and follow the
installation's normal credential-rotation process if it was exposed.

## Local human validation after an authorized fix

Use the repository helper to run the database-backed app on its standard ports:

```sh
npm run feedback:validate -- start
npm run feedback:validate -- status
npm run feedback:validate -- stop
```

`start` reuses healthy compatible services on ports 3000 and 3001 and starts
only missing ones with the development commands in `AGENTS.md`. It refuses to
replace an unknown or incompatible port occupant. `stop` terminates only the
processes recorded as started by this helper; compatible services that predated
the validation session remain running. Logs and the ownership manifest are
stored outside the repository in the operating system's temporary directory.

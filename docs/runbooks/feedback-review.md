# Read-only feedback review

This runbook is the supported internal path for listing and inspecting feedback.
It does not add a user-facing feedback inbox. The human running the review makes
all product decisions; creating issues, branches, pull requests, or code changes
requires a separate explicit instruction.

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

## List the queue safely

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

JSON is the default output for later AI-assisted sessions. `--format text`
pretty-prints the same bounded data. Neither command mutates feedback, invokes an
AI model, creates external work, or gives ordinary application sessions a read
route. Clear the environment variable after the review session and follow the
installation's normal credential-rotation process if it was exposed.

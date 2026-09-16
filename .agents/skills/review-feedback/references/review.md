# Feedback review workflow

## Resolve the target safely

Infer the matching database access path from the repository, environment, and
configured operator tooling; do not require a particular environment variable.
Inspect only the host and database name needed to confirm the target, and never
print a connection URI, username, password, query parameters, or other secrets.

Resolve access in this order:

1. Use an already-configured dedicated feedback-review connection or database
   tool for the inferred instance.
2. For `local`, use the repository's local database configuration when it is
   clearly the selected development instance.
3. For the synthetic `public demo`, use the exact demo Kubernetes context and
   dedicated `open-triage-feedback-reviewer` Secret. Never use the application
   `open-triage-database` Secret.
4. For production or another non-synthetic installation, require a dedicated
   least-privilege reviewer connection as described in
   [the runbook](../../../../docs/runbooks/feedback-review.md).

Use `npm run feedback:review:context -w @open-triage/database -- --instance
<local|public-demo> ...`. The wrapper gives the URI only to the child review
command. Keep it in memory and out of shell tracing, files, command output, and
reports. If safe access cannot be inferred, identify the missing prerequisite
without searching unrelated credentials or guessing a target.

## Use the guarded read-only interface

Read [the feedback review runbook](../../../../docs/runbooks/feedback-review.md)
completely before querying. Use only the supported feedback-review CLI through
the context wrapper. It assumes the fixed reviewer role and enforces read-only
transactions; do not query feedback tables directly or use arbitrary SQL.
Refuse access that cannot enter the reviewer role or does not match the target.

Run `list-open` for the complete queue. It fetches `new`, `triaged`, `planned`,
and `in_progress` items, follows every opaque cursor, and groups results by
status. Exclude terminal items unless one is specifically relevant to a
duplicate or regression. Run `show --reference <REFERENCE>` for every open
item.

Review all relevant available evidence:

- immutable description, current projection, and review history;
- sanitized mode, screen, viewport, interactions, and request failures;
- relevant source, tests, documentation, configuration, and version history;
- relationships among open reports and any relevant terminal item.

Use read-only repository inspection and diagnostics. Do not reproduce a report
through actions that mutate the app, database, deployment, or an external
system. Separate observations from inference, and identify missing, expired,
contradictory, or insufficient evidence.

## Recommend without deciding

For each distinct item, recommend a next status and priority, rationale and
confidence, likely cause and affected area when supported, bounded action,
verification criteria, and any proposed canonical/duplicate relationship.

Use this priority rubric, allowing evidence to override age or wording:

- `urgent`: credible security/privacy exposure, clinical-safety risk,
  destructive data loss, or an installation-wide outage;
- `high`: blocked core workflow, incorrect durable state, or repeatable failure
  without a reasonable workaround;
- `normal`: functional or significant usability defect with a workaround or
  limited scope;
- `low`: cosmetic polish or minor inconvenience.

Group large queues by product area or failure theme. Shared area alone does not
make items duplicates. Lead with urgent and high work, list canonical items
before proposed duplicates, and finish with an ordered action sequence.

Do not use `propose`, `dry-run`, `apply`, `bulk-dry-run`, or `bulk-apply` during
an ordinary review. When the user separately authorizes decisions, re-read each
affected item, use its latest expected version, preview when appropriate, and
invoke the guarded command through the same context wrapper.

## Report safely

Start the final response with the reviewed instance and counts by open status.
Include only diagnostic details material to recommendations. Never expose
credentials, raw connection URLs, internal database identifiers, complete
diagnostic payloads, or unrelated sensitive data. Use the opaque feedback
reference as the stable identifier.

If no open items exist, state that plainly and identify the instance. Return the
review in conversation unless the user explicitly requests an artifact.

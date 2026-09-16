---
name: review-feedback
description: Review feedback stored by an OpenTriage installation, investigate the relevant evidence and code, summarize every open item, and recommend triage and implementation actions. Use for requests to review, inspect, summarize, or triage submitted user feedback. Do not use this skill to apply review decisions or implement fixes unless the user separately authorizes those actions.
---

# Review Feedback

Review one OpenTriage installation's feedback queue without changing the database,
repository, deployment, or external systems.

## Establish the target

In the first response, state the inferred instance, such as `local` or `public
demo`, before running a query. Prefer the user's explicit target, then clear
conversation context. Infer the matching database access path from the available
repository, environment, and already-configured operator tooling; do not require
the user to export a particular variable before invoking the skill.

Require clarification before querying when the target is ambiguous or conflicts
with the sanitized connection host/database. Inspect only the host and database
name needed for this check; never print or expose the connection URI, username,
password, query parameters, or other secret material.

Resolve access in this order:

1. Use an already-configured dedicated feedback-review connection or database
   tool for the inferred instance.
2. For `local`, use the repository's local database configuration when that is
   the clearly selected development instance.
3. For the synthetic `public demo`, use the exact demo Kubernetes context and
   the dedicated `open-triage-feedback-reviewer` Secret. Never use the
   application `open-triage-database` Secret.
4. For any production or non-synthetic installation, require a dedicated
   least-privilege reviewer connection as described in
   [the feedback review runbook](../../../docs/runbooks/feedback-review.md).

Use `npm run feedback:review:context -w @open-triage/database -- --instance
<local|public-demo> ...` to resolve the selected connection. The wrapper loads
the URI only in the child review command's environment. Keep it in memory, never
echo it, never write it to the repository or a temporary file, and do not include
it in shell tracing, command output, or the report. If no safe access path can be
inferred, identify what is missing without searching unrelated credentials or
guessing a target.

## Use the supported read-only interface

Read the feedback review runbook completely before querying. Use only the
repository's `npm run feedback:review -w @open-triage/database -- ...` CLI with
the resolved connection. The CLI must assume the fixed reviewer role and enforce
a read-only transaction; do not query feedback tables directly or use an
arbitrary SQL interface. Refuse a connection that cannot enter the reviewer role
or that does not match the inferred instance.

Treat `new`, `triaged`, `planned`, and `in_progress` as open. Query each status
and follow every returned opaque pagination cursor until exhaustion; never edit,
decode, or synthesize a cursor. Exclude `resolved`, `declined`, and `duplicate`
unless a specific terminal item is relevant to identifying a duplicate or
regression.

Run `show --reference <REFERENCE>` for every open item. Review all relevant
available evidence:

- the immutable description, current review projection, and review history;
- sanitized diagnostics, including mode, screen, viewport, interactions, and
  normalized request failures when they bear on the report;
- relevant source, tests, documentation, configuration, and version history;
- relationships among open reports and any specifically relevant terminal item.

Use read-only repository inspection and diagnostic commands. Do not reproduce a
problem through actions that mutate application, database, deployment, or
external state. Clearly separate observed evidence from inference and state when
evidence is missing, expired, contradictory, or insufficient.

## Recommend, but do not decide

For each distinct item, recommend:

- a next review status and priority;
- a concise rationale and confidence level;
- the likely cause and affected area or files when supported by evidence;
- a bounded implementation course of action;
- verification and acceptance criteria;
- a proposed canonical reference and duplicate relationships when reports are
  substantively equivalent.

Use this priority rubric, letting evidence override age or emphatic wording:

- `urgent`: credible security or privacy exposure, clinical-safety risk,
  destructive data loss, or an installation-wide outage;
- `high`: a blocked core workflow, incorrect durable state, or repeatable
  failure without a reasonable workaround;
- `normal`: a functional or significant usability defect with a workaround or
  limited scope;
- `low`: cosmetic polish or a minor inconvenience.

Group larger queues by product area or failure theme. A shared area alone does
not make reports duplicates: keep distinct behaviors separate. Lead with urgent
and high-priority work, list canonical items before proposed duplicates, and end
with an ordered sequence of recommended next actions.

Do not run `propose`, `dry-run`, `apply`, `bulk-dry-run`, or `bulk-apply` during
an ordinary review. When the user separately and explicitly authorizes review
decisions, re-read every affected item, use its latest expected version, preview
the exact decision when appropriate, and invoke the requested guarded command
through the same context wrapper. Never implement a fix, create an issue,
contact a submitter, or write a repository artifact without separate explicit
authorization.

## Report safely

Start the final response with the reviewed instance and counts by open status.
Summarize only diagnostic details material to the recommendations. Do not dump
complete diagnostic payloads or expose credentials, raw connection URLs,
internal database identifiers, or unrelated potentially sensitive data. The
opaque feedback reference is the stable identifier to report.

If no open items exist, say so plainly and identify the reviewed instance. By
default, return the review only in the conversation; create a Markdown report or
other artifact only when explicitly requested.

---
name: ticket-dispatcher
description: Find the next unblocked subissue of the linkedparent github issue, account for merged and open sub-PRs against the feature branch, and dispatch each ready ticket to a parallel coding agent. Use when asked to run or continue the ticket-dispatcher workflow.
---

# Ticket Dispatcher

Act as the dispatch agent for this workflow. Complete the discovery and dependency analysis locally, delegate every ready ticket in one parallel batch, then wait for all delegated agents and report their outcomes.

## 1. Identify the feature branch

Run:

```bash
git branch --show-current
```

The current non-`main` branch is the feature branch; all sub-PRs target it. If the current branch is `main`, inspect local and remote branches plus the issue files to find the feature branch. Check it out if it already exists. Create it only when its exact intended name is established from repository context or the user. Do not invent a branch name; if more than one candidate remains plausible, ask the user and stop.

## 2. Read all subissues

Read every subissue of the linked parent github issue. For each subissue extract:

- **Ticket number:** the leading digits, such as `001`.
- **Title:** the first `# H1` heading.
- **Slug:** the filename portion after the numeric prefix and separator, without `.md`.
- **Blocked by:** every issue filename or number listed under `## Blocked by`. Treat `None`, an empty section, or a missing section as no dependencies. Normalize references to their leading ticket numbers.

Build a dependency map of `ticket number -> blocked-by ticket numbers`. Retain each issue's path and full contents for dispatching.

If a dependency references no discovered ticket, report the malformed dependency as blocked rather than silently treating it as complete.

## 3. Find merged and in-progress sub-PRs

Run these commands, substituting the feature branch exactly:

```bash
gh pr list --base <feature-branch> --state merged --json number,title,headRefName
gh pr list --base <feature-branch> --state open --json number,title,headRefName
```

A PR belongs to ticket `NNN` when its `headRefName` contains the ticket segment, for example `<feature-branch>/001-db-migration`. Collect matching ticket numbers from merged PRs as **done** and from open PRs as **in progress**. An open PR must never be dispatched again.

If GitHub authentication or either query fails, report the failure and stop; do not dispatch from incomplete PR state.

## 4. Determine ready tickets

A ticket is **ready** only when all of these are true:

1. It is not in the done set.
2. It is not in the in-progress set.
3. Every ticket it depends on is in the done set.

Compute all ready tickets from the same snapshot. If none are ready, report merged, in-progress, and blocked tickets with their blockers, then stop.

## 5. Dispatch every ready ticket in parallel

For every ready ticket, include the full verbatim contents of its issue file in a self-contained agent prompt, followed by the standard instructions below with all placeholders substituted.

Use the `task` tool with `agent_type: general-purpose` when available. Otherwise use the host's equivalent coding-subagent tool. Launch one agent per ready ticket in a single parallel batch/tool-call turn. Do not create user-owned Codex tasks or run the agents sequentially. Do not dispatch the same ticket more than once.

Use this exact instruction block in each prompt:

---

**Branch & PR instructions:**

1. `git checkout <feature-branch> && git pull && git checkout -b <feature-branch>/NNN-<slug>`
2. Implement everything in the acceptance criteria.
3. Commit your changes with a descriptive message.
4. Open a PR targeting `<feature-branch>`, not the repository's default branch. Title: `[<feature-branch>] NNN — <title>`
5. Link the PR to the subissue.

**Definition of done:**

- All acceptance criteria in the issue are met.
- PR is open against `<feature-branch>`.
- Run the repository's relevant build, type-check, lint, and other required validation commands; fix failures before committing.
- Run the relevant tests and fix any failures before committing.
- Once the issue PR is merged, mark the corresponding issue as closed

---

Do not weaken these requirements inside an agent prompt. The full issue content must be verbatim, not summarized.

## 6. Report and wait

Immediately after dispatching, print one table covering every discovered ticket:

| Ticket | Title | Status |
| --- | --- | --- |
| 001 | ... | ✅ Merged |
| 002 | ... | 🔄 In Progress |
| 003 | ... | 🚀 Dispatched now |
| 004 | ... | 🔒 Blocked by 001 |

Then wait for every dispatched agent to reach a terminal outcome. Use the host's multi-agent wait mechanism and avoid busy polling. When all agents finish, report each ticket's outcome, PR link when opened, verification results, and any blocker or failure. An agent failure does not make the ticket merged or complete.

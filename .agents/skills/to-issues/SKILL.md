---
name: to-issues
description: Create a main GitHub issue containing a PRD, then break a plan, specification, or PRD into independently grabbable tracer-bullet vertical slices and publish them as GitHub sub-issues. Use when the user wants to convert a plan into issues, create implementation tickets, or break down work into issues.
---

# To Issues

Using a PRD or the context you have, break a plan into independently grabbable, end-to-end vertical slices. After explicit approval, publish a parent GitHub issue with the main context/PRD plus real GitHub sub-issues.

## Process

### 1. Gather context

Work from the conversation context. If the user provides a PRD, plan, specification, or other source document, treat it as the source of truth. Do not invent scope to make the breakdown look complete; call out unresolved inputs.

Determine the target GitHub repository from the current checkout when possible. If the target is absent or ambiguous, ask the user before any GitHub write.

### 2. Explore the codebase when needed

If the codebase has not already been explored sufficiently, inspect it to understand its current architecture, integration boundaries, conventions, and test patterns. Answer codebase questions through exploration rather than asking the user.

### 3. Draft tracer-bullet vertical slices

Break the plan into thin issues that each cut through every integration layer needed for a narrow, complete behavior. Do not create horizontal tickets organized solely around schema, API, UI, or tests.

Each slice must:

- deliver a narrow but complete path through all applicable layers, such as schema, API, UI, and tests;
- be independently grabbable once its declared blockers are complete;
- be demoable or objectively verifiable on its own; and
- stay thin enough that many small slices are preferred over a few large slices.

Classify every slice as:

- **AFK** when it can be implemented and merged without human interaction; or
- **HITL** when it contains a genuine human checkpoint such as an architectural decision, product choice, or design review.

Prefer AFK. Do not mark a slice HITL merely because ordinary review or approval is part of the development process.

### 4. Obtain breakdown and publication approval

Present the proposed slices as a numbered list. For each slice, show:

- **Title**: a short descriptive name;
- **Type**: HITL or AFK;
- **Blocked by**: prerequisite slices, if any; and
- **User stories covered**: identifiers from the source material, when present.

Ask whether:

- the granularity is too coarse, too fine, or right;
- dependency relationships are correct;
- any slices should be merged or split; and
- HITL and AFK classifications are correct.

Also identify the exact target repository and ask the user to approve publishing the parent issue and sub-issues there. Iterate until the breakdown is approved. Do not create GitHub issues before that approval.

### 5. Publish the GitHub issue hierarchy

Use an available authenticated GitHub integration or CLI. First create one parent issue whose body contains the PRD. If the source is not already formatted as a PRD, faithfully synthesize its product intent, requirements, user stories, implementation decisions, testing decisions, out-of-scope items, and notes without expanding scope.

Then create one GitHub issue per slice, preserving dependency order and HITL/AFK classification in the title, labels, or body according to repository conventions. Replace local filename-only blocker references in the published bodies with links to the corresponding GitHub issues when possible.

Use this body template:
```markdown
## What to build

A concise description of the end-to-end behavior delivered by this vertical slice. Do not organize the description layer by layer.

## Acceptance criteria

- [ ] An externally observable, objectively verifiable criterion
- [ ] Another externally observable, objectively verifiable criterion
- [ ] Relevant tests demonstrate the completed behavior

## Blocked by

- Blocked by `002-filename.md`
```
When there are no blockers, write `None - can start immediately` under **Blocked by**. Reference only earlier-numbered files; if that is impossible, fix the ordering or identify a dependency cycle before continuing.

Attach every child to the parent using GitHub's actual sub-issue relationship. Do not represent sub-issues only as a Markdown checklist and claim they are attached. If the available GitHub tooling cannot create the relationship, stop after creating the local drafts unless the user explicitly approves a documented fallback. Avoid duplicate issue creation when retrying: inspect existing results and resume from the first missing item.

### 7. Report results

Summarize:
- the parent GitHub issue link;
- every child issue link and its HITL/AFK type;
- the dependency order; and
- any publication or relationship failures that remain unresolved.

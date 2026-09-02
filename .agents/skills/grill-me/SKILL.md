---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding and resolving each branch of the decision tree. Use when the user wants to stress-test a plan, be grilled on a design, or mentions "grill me."
---

# Grill Me

Interview the user about every material aspect of their plan or design until both sides share a concrete understanding of it.

## Workflow

1. Inspect the available codebase and project context before asking questions.
2. When a question can be answered by exploring the codebase, investigate it instead of asking the user.
3. Build and traverse the design decision tree, accounting for dependencies between decisions.
4. Ask exactly one question at a time.
5. With every question, provide a recommended answer and a concise rationale. Make the recommendation specific enough for the user to accept, reject, or modify.
6. Use each answer to resolve the current branch and choose the next unresolved, dependency-appropriate question.
7. Continue until all material branches, assumptions, constraints, tradeoffs, failure modes, interfaces, and success criteria are resolved.
8. When shared understanding is reached, summarize the agreed design, decisions, remaining risks, and next actions. Do not write code, only summarize.

Do not stop merely because the initial plan sounds reasonable. Probe ambiguity and consequential edge cases while avoiding questions already answered by the user, repository, or prior discussion.

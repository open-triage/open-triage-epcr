---
name: to-prd
description: Turn the current conversation context and codebase understanding into a product requirements document and save it as a Markdown file. Use when the user wants to create a PRD from the current context.
---

# To PRD

Synthesize what is already known into a PRD. Do not interview the user for new product requirements. The only questions permitted are the explicit module-and-testing confirmation required below.

## Process

1. Review the current conversation and inspect the repository to understand the codebase's present state, unless that exploration has already been completed and remains current.
2. Sketch the major modules that must be built or modified. Actively seek deep modules: components that encapsulate substantial functionality behind a small, stable, independently testable interface. Avoid shallow abstractions that merely redistribute complexity.
3. Present the proposed modules and your testing recommendation to the user. Ask them to confirm whether the modules match their expectations and which modules they want tested. This is a focused approval checkpoint, not a requirements interview. If both decisions are already explicit in the conversation, do not ask again.
4. After confirmation, write the PRD as a `.md` file in the current project. Choose a concise, descriptive filename unless the user specified one.
5. Return a link to the completed file.

Do not add requirements unsupported by the conversation or repository. Identify necessary inferences as decisions or notes rather than pretending they came from the user.

## PRD Template

# Problem Statement

Describe the problem from the user's perspective.

# Solution

Describe the solution from the user's perspective.

# User Stories

Provide a long, numbered, comprehensive list covering every known aspect of the feature. Use this format for each item:

`1. As a <type of user>, I want <capability>, so that <benefit>.`

Keep each story externally meaningful and avoid implementation tasks disguised as user stories.

# Implementation Decisions

List the implementation decisions made, including as applicable:

- modules to build or modify;
- module interfaces that will change;
- technical clarifications;
- architectural decisions;
- schema changes;
- API contracts; and
- specific interactions.

Do not include specific file paths or code snippets because they can become outdated quickly.

# Testing Decisions

List the testing decisions made. Include:

- the principle that good tests verify externally observable behavior rather than implementation details;
- the modules selected for testing; and
- relevant prior art from similar tests in the codebase.

# Out of Scope

Describe everything explicitly outside this PRD's scope.

# Further Notes

Capture remaining context, assumptions, dependencies, risks, or unresolved points without inventing requirements.

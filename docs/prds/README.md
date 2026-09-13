# Product requirements documents

These documents record the product intent and delivery boundaries behind the
OpenTriage implementation. They are useful design history, but the code,
database migrations, tests, and current GitHub issues remain authoritative for
implemented behavior.

| Document | Role | Relationship / issue |
| --- | --- | --- |
| [OpenTriage demo](open-triage-demo.md) | Broad demo product baseline | Precedes the narrower MVP definition |
| [OpenTriage MVP](open-triage-mvp.md) | First delivery scope | Implemented through GitHub issue #54 and its subissues |
| [Mobile call flow](flow-mobile.md) | Feature specification | Extends the MVP with assigned-call and mobile workflow behavior |
| [Dispatch payload](dispatch-payload.md) | Feature specification | Defines dispatch ingestion and projection boundaries |
| [Stationary workflow MVP](stationary-workflow-mvp.md) | Feature specification | Defines the stationary documentation workflow |
| [Admin controls](admin-controls.md) | Broad product direction | Parent scope for administration capabilities |
| [Admin controls MVP](admin-controls-mvp.md) | Reduced delivery scope | Scoped by GitHub issue #252; see the [validation runbook](../runbooks/admin-controls-mvp-representative-validation.md) |
| [Users and roles](users-roles.md) | Feature specification | Extracts the Users/Roles vertical slice and role-based Clinical Demo behavior from Admin Controls |

When a PRD is replaced, keep it here as design history and add a prominent
supersession note linking to its replacement. New PRDs should use lowercase,
kebab-case filenames and be added to this index.

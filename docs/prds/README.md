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
| [Protected offline clinical storage](protected-offline-clinical-storage.md) | Security feature specification | Defines encrypted browser persistence and supersedes older plaintext/offline-restart assumptions; parent issue #418 |
| [Dispatch payload](dispatch-payload.md) | Feature specification | Defines dispatch ingestion and projection boundaries |
| [Stationary workflow MVP](stationary-workflow-mvp.md) | Feature specification | Defines the stationary documentation workflow |
| [Admin controls](admin-controls.md) | Broad product direction | Parent scope for administration capabilities |
| [Admin controls MVP](admin-controls-mvp.md) | Reduced delivery scope | Scoped by GitHub issue #252; see the [validation runbook](../runbooks/admin-controls-mvp-representative-validation.md) |
| [Users and roles](users-roles.md) | Feature specification | Extracts the Users/Roles vertical slice and role-based Clinical Demo behavior from Admin Controls |
| [Localization](localization.md) | Feature specification | Defines agency-wide language and regional settings, versioned definition translations, and the first Swedish translation pass; parent issue [#559](https://github.com/open-triage/open-triage-epcr/issues/559) |
| [User feedback](user-feedback.md) | Feature specification | Defines safe bug reporting, feature requests, diagnostics, retention, and human-approved AI review |
| [Review and basic analytics](review.md) | Feature specification | Defines scoped review queues, overdue-draft follow-up, basic BI and CSV exports, and custom-element long-table analytics; parent issue [#642](https://github.com/open-triage/open-triage-epcr/issues/642) |
| [Unified analytics workspace](unified-analytics-workspace.md) | Feature specification | Supersedes Review's analytics workspace presentation with one control rail and visualization; replaces the Review banner with a Review / Analytics selector while retaining the current app shell and Review workflow |
| [Metric library](metric-library.md) | Feature specification | Adds continuous metrics above the Validation Rule library, shares one canonical JSON and version lifecycle, and exposes review-enabled metrics and Boolean rules in Analytics |

When a PRD is replaced, keep it here as design history and add a prominent
supersession note linking to its replacement. New PRDs should use lowercase,
kebab-case filenames and be added to this index.

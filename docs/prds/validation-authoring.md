# Problem Statement

OpenTriage currently spreads clinical validation across the Element Catalog, Form configuration, browser components, and server-side signing logic. Administrators cannot see the complete set of rules that affects a report, cannot consistently modify those rules, and cannot independently version validation behavior. Requiredness and occurrence controls are mixed with element-definition concerns, while some clinical rules exist only in application code.

The product also does not yet represent or execute the full NEMSIS 3.5.1 EMS Schematron rule set. Schematron expresses rules using XML- and XPath-specific concepts that are unsuitable as the normal authoring experience for agency administrators. Some official rules require capabilities beyond simple required-field checks, including nested logic, regular expressions, repeated-group context, element-to-element time comparisons, absence metadata, and occurrence ordering.

Administrators need one place to understand and manage clinical validation without gaining the ability to weaken platform integrity, corrupt stored data, or silently change the rules attached to an in-progress or signed report. Clinicians need the same validation behavior online, offline, and at authoritative server-side signing. Future review workflows also need a server-side rule target, but the first release must not depend on historical, cross-report, or arbitrary database queries.

# Solution

Add a dedicated Validation pane to Administration. The pane manages catalog-bound, versioned validation definitions through the same draft, validation, publication, and activation lifecycle used by Element Catalogs and Forms. A published clinical configuration atomically combines a compatible Form, Element Catalog, and Validation version. Every new report pins that complete configuration so later administrative changes cannot alter its behavior.

Represent each finding-producing validation rule as an independently editable record with structured administrative metadata and a domain-oriented logic script. The script uses optional iteration and applicability clauses plus a required assertion. It supports the smallest language surface necessary to normalize every finding-producing NEMSIS 3.5.1 EMS Schematron assertion, while hiding XML paths, namespaces, attributes, and arbitrary XPath from administrators.

Import all NEMSIS 3.5.1 EMS/PCR finding-producing assertions into an initial, fully editable validation version. Also migrate all existing clinical and business validation into visible rules, including catalog requiredness, editable occurrence policy, and form-required or conditional-required behavior. Keep Element Catalog labels, datatypes, code lists, code labels, code enablement, defaults, storage metadata, and structural capabilities in the Element Catalog. Keep Form visibility in Form authoring. Keep authorization, command shape, datatype safety, identity integrity, valid catalog references, and other platform-integrity checks enforced by the platform rather than editable as clinical rules.

Compile published validation definitions into deterministic, immutable rule bundles. Cache live rules with the report's pinned Form and Catalog so browser validation works offline. Re-evaluate applicable rules authoritatively on the server during signing and expose a server-side evaluation interface for forthcoming review features. Preserve imported source provenance, publication history, acknowledgements, and findings so behavior remains explainable and auditable.

# User Stories

1. As an administrator, I want a dedicated Validation pane, so that I can manage clinical rules without searching through Catalog, Form, and application-specific settings.

2. As an administrator, I want to see every active clinical and business validation rule, so that the effective validation policy is transparent.

3. As an administrator, I want to create an agency-authored validation rule, so that local clinical requirements can be enforced without changing application code.

4. As an administrator, I want to modify any imported NEMSIS rule in my organization's validation copy, so that the rule set can reflect agency policy.

5. As an administrator, I want to disable rather than permanently delete a rule, so that removed behavior remains auditable and can be restored.

6. As an administrator, I want each rule to have a name, severity, execution targets, primary target, message, and enabled state, so that its behavior and resulting finding are understandable.

7. As an administrator, I want unconditional rules to omit an applicability condition, so that simple required-field rules remain simple.

8. As an administrator, I want conditional rules to separate when they apply from what they require, so that complex rules remain readable.

9. As an administrator, I want repeating-group scope to be part of the rule script, so that rules can evaluate and identify the correct medication, procedure, vital, or other repeated row.

10. As an administrator, I want nested Boolean logic, so that I can express clinically meaningful combinations of conditions.

11. As an administrator, I want rule expressions to support the complete complexity used by NEMSIS 3.5.1 EMS Schematron, so that imported rules do not require a separate XPath authoring mode.

12. As an administrator, I want the language to use report-domain concepts rather than XML axes and attributes, so that I can understand and safely edit imported logic.

13. As an administrator, I want label-aware autocomplete for stable element IDs and code values, so that rules remain readable without becoming dependent on mutable labels.

14. As an administrator, I want inline syntax, reference, and type diagnostics, so that I can repair invalid rules before publication.

15. As an administrator, I want a generated plain-language explanation of a rule, so that I can review its intent alongside its expression.

16. As an administrator, I want to search and filter rules by element, source, severity, execution target, enabled state, and validity, so that a large imported ruleset remains manageable.

17. As an administrator, I want each minimum and maximum occurrence policy represented as a separate rule, so that each can have independent severity, messaging, targets, and execution behavior.

18. As an administrator, I want to override a clinical requirement for at least one documented occurrence, so that selected catalog elements may be skipped when agency policy permits it.

19. As an administrator, I want intrinsic Catalog structure shown as reference information, so that I understand the limits within which clinical occurrence rules operate.

20. As an administrator, I want code lists, labels, code enablement, and defaults to remain in the Element Catalog, so that vocabulary management is not confused with rule authoring.

21. As an administrator, I want conditional requiredness moved from Form authoring into Validation, so that all clinical requirements are managed in one place.

22. As a Form author, I want visibility to remain a Form concern, so that presentation logic stays with the user interface it controls.

23. As an administrator, I want a Validation draft bound to a published Catalog, so that every element and code reference can be checked against a definite definition.

24. As an administrator, I want to bind Forms and Validations to a published but inactive Catalog, so that I can prepare a complete future configuration before activation.

25. As an administrator, I want to clone a published Validation version into a draft bound to a newer Catalog, so that I can carry policy forward and repair only incompatibilities.

26. As an administrator, I want Validation to follow the same create-or-clone, edit, validate, publish, and activate workflow as Forms and Catalogs, so that Administration behaves consistently.

27. As an administrator, I want publication to create an immutable Validation version, so that active and historical behavior cannot be silently rewritten.

28. As an administrator, I want publication and activation to be separate actions, so that a completed version can be reviewed and staged before it affects clinicians.

29. As an administrator, I want Form, Catalog, and Validation activation to be atomic, so that clinicians never receive an incompatible partial configuration.

30. As an administrator, I want activation to verify that live and signing rules reference fields available on the Form or populated by the platform, so that clinicians can satisfy every active requirement.

31. As an administrator, I want an earlier compatible Validation version to be reactivatable, so that rollback is fast and does not mutate history.

32. As an administrator, I want required change notes and a complete audit history for publication and activation, so that validation-policy changes are accountable.

33. As an administrator, I want imported rules to retain their NEMSIS source identity, release, original expression, and original message, so that agency modifications can later be compared with updated standards.

34. As an administrator, I want exact normalized duplicate rules collapsed without losing provenance, so that clinicians do not receive identical duplicate findings.

35. As an administrator, I want similar but non-identical rules preserved and flagged rather than automatically merged, so that the system does not guess about clinical equivalence.

36. As an administrator, I want possible logical conflicts reported as advisory diagnostics, so that I can investigate them without relying on an incomplete general-purpose constraint solver.

37. As an administrator, I want enabled rules to compile and pass reference, type, execution-target, and smoke-evaluation checks before publication, so that a broken ruleset cannot be activated.

38. As an administrator, I want disabled rules preserved even when they are not executable, so that incomplete work or historical source material does not block publication until enabled.

39. As an administrator, I want errors, warnings, and informational findings to have consistent meanings, so that I can predict their clinical effect.

40. As a clinician, I want errors to block signing, so that known-invalid reports cannot be finalized.

41. As a clinician, I want warnings to require explicit acknowledgement, so that exceptional documentation is intentional and auditable.

42. As a clinician, I want warning acknowledgement tied to a specific finding and its relevant inputs, so that an acknowledgement expires when the underlying data changes.

43. As a clinician, I want informational findings never to block work, so that review guidance does not become an unintended signing requirement.

44. As a clinician, I want live validation to work offline, so that field documentation does not depend on network connectivity.

45. As a clinician, I want live findings to identify the relevant field and repeated row, so that I can navigate directly to the problem.

46. As a clinician, I want simple elements to remain skippable when no enabled signing rule requires them, so that Catalog membership alone does not imply required documentation.

47. As a clinician, I want browser and server validation to use the same rule semantics, so that signing does not unexpectedly disagree with live guidance.

48. As a signing clinician, I want server evaluation to be authoritative, so that client manipulation or stale local state cannot bypass validation.

49. As a signing clinician, I want a rule-engine runtime failure to block signing with an identifiable rule error, so that evaluation failures cannot be mistaken for successful validation.

50. As a reviewer, I want rules to be targetable to review-only execution, so that future quality review can apply logic that should not interrupt documentation or signing.

51. As a reviewer, I want review rules limited to catalog elements in the current report, so that initial review behavior is deterministic and does not expose arbitrary database access.

52. As an auditor, I want every new report to pin its Validation version, so that I can reproduce the policy under which it was completed.

53. As an auditor, I want signed legacy reports to remain explicitly unversioned rather than assigned a ruleset they never used, so that historical metadata remains truthful.

54. As an auditor, I want a later review of a legacy report recorded separately with the explicitly selected Validation version, so that retrospective results do not alter the signed record.

55. As an installation owner, I want Validation permissions separate from Catalog and Form permissions, so that clinical rule authority can be delegated independently.

56. As an installation owner, I want Owners and Administrators to receive Validation read, write, and publish capabilities by default, so that they can manage the complete lifecycle.

57. As a Demo user, I want Validation read and write access without publication or activation, so that I can demonstrate authoring without changing active clinical behavior.

58. As an administrator of custom roles, I want Validation capabilities to require explicit assignment, so that new authority is not granted implicitly.

59. As a deployment operator, I want the unsigned-report reset to show affected counts and require explicit confirmation, so that rollout deletion is deliberate rather than hidden in a schema migration.

60. As a standards maintainer, I want imported-rule outcomes to match the official NEMSIS 3.5.1 EMS fixture suite by rule identity, so that normalization can be proven equivalent.

# Implementation Decisions

## Modules

1. **Validation language module.** Build a deep, shared module responsible for parsing, formatting, canonicalization, static reference extraction, type checking, feature validation, compilation, and deterministic evaluation. Its public interfaces accept source text and a catalog definition, return canonical compiled rules plus structured diagnostics, and evaluate compiled rules against a report-domain document, explicit evaluation timestamp, and execution target. Browser and server consumers must use the same semantics.

2. **NEMSIS importer module.** Build an importer that reads the pinned NEMSIS 3.5.1 EMS Schematron source, expands shared contexts, converts each finding-producing assertion into one domain rule, maps severity and primary target, preserves source provenance, and accounts for non-finding control constructs internally. The importer must emit a compatibility report rather than silently omitting unsupported constructs.

3. **Validation versioning module.** Add organization-scoped Validation drafts, immutable published versions, independently identified rules, source snapshots, change history, publication records, activation records, and compiled artifacts. A Validation draft and published version must reference exactly one published Catalog release. Published records are immutable; changes start from a clone. Foreign-key access paths used for organization, Catalog, version, rule, and activation lookups must be indexed. State and severity values must be constrained, and timestamps must be timezone-aware.

4. **Administration API module.** Add authorized contracts and endpoints for listing versions and rules, creating or cloning drafts, saving revision-checked edits, validating drafts, publishing, activating compatible bundles, reactivating earlier versions, and reading history. Mutations use optimistic revisions and short transactions. Compilation and other expensive work should occur before acquiring activation or publication locks where possible.

5. **Validation pane module.** Add a master-detail Administration experience with version selection, rule search and filtering, structured metadata controls, an assisted text editor, inline diagnostics, a generated explanation, history, and lifecycle actions. The editor stores stable identifiers while presenting current labels and code descriptions as assistance. It does not include a visual builder or per-rule test console.

6. **Runtime validation module.** Publish immutable compiled bundles with integrity digests. Include applicable live rules, messages, and target metadata in offline report configuration. Evaluate sign rules authoritatively on the server and expose the same server evaluator for future review calls. Findings carry rule version, rule identity, severity, target, repeated occurrence context, and an input fingerprint suitable for acknowledgement invalidation. Runtime evaluation is bounded, uses safe regular-expression behavior, forbids recursion and user-defined functions, and fails closed for signing.

7. **Configuration bundle module.** Extend active configuration from Form plus Catalog to Form plus Catalog plus Validation. Activation must atomically verify that both authored versions bind to the selected Catalog, that published artifacts are intact, and that every element referenced by an enabled live or sign rule is present on the Form or supplied by an approved platform source. Existing reports retain their pinned versions when activation changes.

8. **Occurrence model module.** Refactor report occurrences so an ordinary scalar or coded value, a Not Value, and a Pertinent Negative can be represented as separate properties when allowed by NEMSIS. Preserve Catalog-declared support constraints and validate legal combinations through platform integrity and imported clinical rules as appropriate. Update persistence, offline serialization, dispatch ingestion, amendment, signing, display, and NEMSIS export consumers consistently.

9. **Migration and authorization module.** Add dedicated Validation read, write, and publish capabilities. Grant all three to the installation owner and built-in Administrator, grant read and write to Demo, and grant none to custom roles until assigned. Provide an explicit, operator-confirmed rollout command for unsigned reports and calls. Seed initial published Validation versions from existing business rules and the imported NEMSIS rules. Mark pre-existing signed reports as legacy and unversioned.

## Rule representation and semantics

- A rule has immutable identity plus editable name, enabled state, severity, execution targets, primary target element, message, and domain-language source.
- Rule removal is archival or disablement, not physical deletion.
- Rule logic supports an optional group scope (singleton or repeating), an optional applicability condition, and one required assertion.
- A missing applicability condition means the rule applies to every existing scope instance, or to the whole report for an unscoped rule. A missing group or zero group instances skips a scoped rule; an existing empty instance is evaluated.
- `minimumGroups("<group ID>", n)` and `maximumGroups("<group ID>", n)` count group instances directly, including empty instances. Unscoped rules count across the report; scoped rules count the current instance and its descendants. A group container with no instances counts as zero. Use an unscoped `require minimumGroups("eVitals.VitalGroup", 1)` to require a vitals set even when the group is absent. Group references must exist in the bound Catalog, and counts must be non-negative safe integers. The primary element target locates the finding and does not supply the group count.
- Each failure produces one finding for the relevant scope occurrence and primary target.
- Minimum and maximum policies are separate rules.
- Imported NEMSIS warnings and errors map to the corresponding product severities. Agency rules may also use informational severity.
- Error findings block signing. Warning findings require acknowledgement. Informational findings never block or require acknowledgement.
- Execution targets are live, sign, and review, and a rule may select more than one.
- Imported NEMSIS EMS rules default to live and sign.
- Review-target evaluation is implemented server-side, but review workflow and user interface are deferred.

## Language boundary

- The language is declarative and report-domain-specific rather than general purpose.
- It must cover every construct needed by the pinned NEMSIS 3.5.1 EMS finding-producing assertions.
- Required capabilities include nested Boolean expressions; existence and count operations; singular and collection comparisons; any/all quantification; membership; safe regular-expression matching; element-to-element comparison; repeated-group and occurrence context; date and time comparison; the bounded date arithmetic present in NEMSIS; value, code-system, and absence semantics; and ordering or adjacency where required by the official rules.
- XML namespaces, raw XPath axes, XML node tests, arbitrary XSLT, direct database queries, historical report access, network access, user-defined functions, recursion, and unbounded iteration are not exposed.
- A future NEMSIS import must fail compatibility checks and identify newly required language features before the version can be activated.
- Exact fixture parity is defined as the same finding-producing NEMSIS rule identities firing for the same official EMS fixtures. Message rendering may differ without violating parity.

## Catalog, Form, and platform boundaries

- Element labels, stable identity, datatype, storage semantics, code lists, code labels, code enablement, defaults, allowed absence capabilities, and intrinsic structural bounds remain Catalog concerns.
- Editable requiredness, documented minimum occurrence, documented maximum occurrence, and conditional clinical requirements become Validation rules.
- Structural minimum occurrence and documented minimum occurrence are distinct. A structurally required XML node does not by itself require a clinician-supplied value.
- A Validation rule may be stricter than the Catalog but cannot make a structurally unsupported value, datatype, code, or occurrence valid.
- Export remains responsible for producing structurally valid NEMSIS XML. Where the standard permits a valid absence representation, skipped clinical data may serialize accordingly. A state with no legal export representation remains a non-editable export-integrity failure.
- Form visibility remains authored in the Form. Hidden-value integrity is derived from the active Form rather than maintained as a duplicate editable rule.
- Transient controls may prevent structurally incomplete editor input, but every clinical requirement they enforce must also exist as a Validation rule.
- Authorization, CSRF, command schemas, immutable identity, referential integrity, datatype storage safety, and similar platform constraints remain non-editable.

## Versioning, activation, and audit

- Validation drafts use optimistic revision checks.
- Publication requires a display name and change note and creates an immutable version plus compiled artifact digest.
- Publication gates apply to enabled rules and include parsing, static typing, stable reference resolution, Catalog compatibility, execution-target compatibility, bounded compilation, and full-ruleset smoke evaluation.
- Disabled rules remain in the published source history but do not execute.
- Publication does not change active clinical behavior.
- Activation requires a change note and atomically selects one compatible published Form, Catalog, and Validation version.
- Failed activation leaves the previous bundle active.
- Rollback reactivates an earlier compatible published bundle; it does not mutate versions or repin existing reports.
- Every publication and activation records the actor, organization, timestamp, source and destination versions, note, and rule-level additions, modifications, disablements, and execution-target changes.
- Imported rules retain immutable source identity, source release/build, original expression, and original message alongside the editable normalized copy.
- Exact normalized duplicates may share one executable rule while retaining multiple provenance links. Non-identical overlaps remain separate and receive advisory diagnostics.

## Runtime and report interaction

- Report creation pins Form, Catalog, and Validation identifiers and immutable artifact digests.
- The offline report package contains the compiled live-validation subset needed for that report.
- Evaluation accepts an explicit time input. Live evaluation uses a captured client evaluation time; signing uses server time.
- Live runtime failures surface without crashing the form. Sign runtime failures block signing and identify the failed rule. Review runtime failures mark the review evaluation as failed rather than producing a false pass.
- Acknowledgements bind to the Validation version, rule, target occurrence, and relevant input fingerprint. Changed relevant inputs invalidate the acknowledgement.
- Signed findings and acknowledgements remain attached to the pinned rule version.
- Legacy signed reports are not retroactively assigned the initial Validation version. Later review results identify the explicitly selected Validation version and do not alter the signed result.

## API contracts and authorization

- Add contracts for Validation summaries, paginated rule lists, drafts, published versions, rule diagnostics, compiled-version status, history, publication commands, activation commands, and active bundle details.
- Rule-list APIs support server-side filtering and stable pagination suitable for the imported ruleset.
- Read, write, and publish checks occur server-side even when the pane hides unauthorized actions.
- Validation publication authority also permits activation in the initial capability model.
- Owner and Administrator receive read, write, and publish. Demo receives read and write only. Custom roles require explicit grants.

## Migration

- The rollout reset is an explicit operational command, not a hidden destructive schema migration.
- The command reports affected unsigned call and report counts and requires confirmation before deletion.
- Database schema changes remain independently deployable and idempotent where supported by the existing migration framework.
- Initial Validation versions include migrated Catalog requiredness and editable occurrence policy, migrated Form requiredness and conditional requiredness, existing code-backed clinical business rules, and normalized NEMSIS 3.5.1 EMS rules.
- The migration inventory must distinguish clinical/business rules from platform integrity and transient input-shape checks.
- Existing signed reports, signatures, findings, and acknowledgements are preserved.

# Testing Decisions

Good tests verify externally observable behavior rather than parser internals, component implementation details, private database queries, or incidental markup. The feature requires tests for all nine approved modules.

1. **Validation language tests** verify accepted and rejected syntax, canonical behavior, type and reference diagnostics, nested logic, repeated scope, absence semantics, time behavior, safe regular expressions, deterministic evaluation, evaluation limits, and equivalent browser/server results.

2. **NEMSIS importer tests** verify that every finding-producing assertion is accounted for, non-finding control constructs are accounted for without appearing as rules, source provenance is preserved, unsupported constructs fail explicitly, and official 3.5.1 EMS fixtures produce the same firing rule identities as the official Schematron.

3. **Validation versioning tests** verify organization isolation, optimistic revision conflicts, immutable publication, Catalog binding, cloning to a new Catalog, disabled-rule behavior, exact duplicate provenance, advisory conflicts, audit events, and rollback through reactivation.

4. **Administration API tests** verify all read, write, publish, and activation authorization boundaries; request validation; stable filtering and pagination; stale updates; publication gates; atomic activation; and safe failure behavior.

5. **Validation pane tests** verify loading and navigating versions, searching and filtering rules, editing metadata and source, label-aware stable identifiers, diagnostics, read-only behavior, permission-specific controls, lifecycle actions, and accessible finding/error announcements.

6. **Runtime validation tests** verify offline live evaluation, server signing authority, severity behavior, primary-target navigation, repeated-row targeting, acknowledgement creation and invalidation, bounded execution, runtime failure behavior, and compiled artifact integrity.

7. **Configuration bundle tests** verify compatible atomic activation, rejection of mismatched Catalog bindings, rejection of unavailable Form references, preservation of the previous active bundle after failure, and report pinning across later activations.

8. **Occurrence model tests** verify ordinary values, Not Values, Pertinent Negatives, legal combinations, illegal combinations, repeated occurrences, persistence round trips, offline round trips, dispatch ingestion, amendment, signing, and NEMSIS serialization.

9. **Migration and authorization tests** verify initial grants, Demo publication denial, custom-role defaults, inventory conversion, preservation of signed data, legacy/unversioned marking, affected-count reporting, confirmation requirements, and bounded deletion of unsigned data only.

Relevant prior art exists in the repository's Catalog authoring, Form authoring and publication, Administration shell and directory, stationary validation and offline report, draft and signing service, role authorization, migration artifact, and PostgreSQL integration tests. New tests should follow those established boundaries while adding explicit parity coverage between browser and server evaluation.

End-to-end coverage must include at least one complete administrative lifecycle from draft through bundle activation, one offline clinical validation and later signing journey, one warning acknowledgement invalidated by a data change, one activation rollback, and one imported NEMSIS rule involving repeated scope or absence metadata.

# Out of Scope

- NEMSIS Demographic dataset Schematron rules.
- NEMSIS State dataset Schematron rules.
- State-specific, territory-specific, or special-project Schematron packages.
- A general-purpose XPath, XSLT, JavaScript, SQL, or arbitrary scripting runtime.
- Raw XPath editing in the Administration interface.
- A visual or drag-and-drop rule builder.
- A per-rule interactive test console.
- Mandatory saved behavioral test cases for every rule.
- Multilingual validation messages.
- Two-person approval or a mandatory reviewer gate for publication.
- Review queues, reviewer assignments, reviewer workflow screens, or retrospective-review product behavior beyond a server evaluation interface.
- Cross-report, longitudinal, patient-history, external-service, or arbitrary database facts in rule expressions.
- Automatic three-way upgrades to a future NEMSIS release; this PRD only preserves the provenance required to build that workflow later.
- Making platform-integrity, authorization, storage, datatype, identity, or referential constraints editable.
- Changing Catalog code-list contents, code labels, code enablement, or defaults through the Validation pane.
- Retroactively changing validation outcomes, signatures, or pinned versions on existing signed reports.

# Further Notes

- The largest technical dependency is the occurrence-model change. The current exclusive pertinent-negative representation cannot express every state inspected by official NEMSIS rules, including a Pertinent Negative that accompanies an ordinary value.
- The importer should be treated as a compiler with complete accounting, not as a best-effort conversion script. Silent omission would make parity claims unreliable.
- Full NEMSIS complexity means full coverage of the pinned NEMSIS 3.5.1 EMS rule corpus, not support for every construct permitted by XPath or Schematron.
- The official NEMSIS EMS Schematron and its published fixtures are external standards inputs and should be pinned by source release and integrity digest for repeatable builds.
- A rule's primary target is intentionally singular even when the logic references several elements. Related references may be shown as explanatory metadata, but navigation and acknowledgement use the primary target.
- Review severity describes the importance of a review finding but does not retroactively block a signed report.
- The implementation must audit existing hard-coded browser and server validation before migration is declared complete. Any clinical requirement left in code must be documented as a deliberate platform or transient-input constraint.
- Database implementation should follow the repository's existing organization isolation and role model, use constrained state transitions, index foreign-key access paths, keep publication and activation transactions short, and avoid granting broad database privileges to application roles.
- The explicit unsigned-data reset is destructive and requires operational documentation, affected-count preview, confirmation, and verification that signed reports are outside its deletion boundary.
- The product decisions in this PRD were reached through the preceding design interview. No visual builder, test console, multilingual authoring, or review workflow should be inferred into the initial delivery.

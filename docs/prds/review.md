# Problem Statement

Clinicians and reviewers need to find reports requiring attention, document their conclusions, and understand patterns across the calls they are authorized to review. Administrators can already author validation rules with a server-side review execution target, but there is no operational review queue, assignment workflow, or Review workspace. Overdue unsigned drafts also need follow-up without entering the signed clinical analytics population.

The database already projects effective signed reports into analytical views, including amended values and identifying-data boundaries. Users need a basic interface for descriptive statistics and exports of both aggregate results and the records underlying a visualization. Custom clinical elements must participate without requiring a new analytical column whenever an agency defines a field.

# Solution

Add an online-only **Review** mode to the existing Mobile / Stationary / Admin selector. Use the project's current interface conventions for review queues, a report viewer with review context, basic analytics, saved analyses, and review administration. The historical interface design supplied by the user informs the workflow; it is reference material rather than a binding screen specification or a source of additional requirements.

Create one review item for each patient report and matching criterion. Give each item an assignee, priority, workflow status, outcome, comments, and durable history. Evaluate ordinary criteria after signing and relevant signed amendments. Support a separate overdue-draft workflow, automatic routing, independent review, and deliberate retrospective evaluation.

Provide a basic analysis builder with simple filters, one grouping at a time, standard descriptive summaries, and a few starter views. Query the existing analytics projections through an authorized API. Export the displayed aggregate data and the underlying report records as CSV. Project every custom value into the long analytical table, retaining typed values and occurrence relationships.

# User Stories

1. As an authorized user, I want Review available alongside the existing application modes, so that I can move between documentation, administration, and review in one application.
2. As a reviewer, I want Review to use familiar controls and layout conventions, so that I can work without learning the historical mockup's interface.
3. As a user, I want Review to show its online requirement and data freshness, so that I understand when its information can be used.
4. As a clinician with review-self, I want access to my documented reports and personal statistics, so that my review scope includes more than items explicitly assigned to me.
5. As a reviewer with review-all, I want access to eligible reports throughout my organization, so that I can perform organization-wide review.
6. As a review administrator, I want to assign and reassign review items, so that responsibility can be managed separately from permission to read reports.
7. As a review administrator, I want to configure automatic routing by criterion, so that new matches reach the intended clinician, reviewer, or shared queue.
8. As an authorized user, I want identifying information available only with review-identifying and within my existing report scope, so that this capability never grants access to additional reports.
9. As a user without identifying permission, I want identifying fields, clinical free text, photos, and audio withheld consistently, so that record views, filters, and exports respect the same boundary.
10. As a role administrator, I want review capabilities assignable through the existing role model, so that review access follows established administration and audit behavior.
11. As a clinician, I want the built-in Clinician role to include self-review, so that I can use the new workflow for my own documentation.
12. As a role administrator, I want usable Reviewer and Review administrator roles, so that common review responsibilities are straightforward to assign.
13. As a demonstration user, I want review-all, review-admin, and review-identifying, so that I can exercise the complete review experience using synthetic records.
14. As an administrator with validation authoring permissions, I want to define review criteria in the existing validation rule editor, so that the feature uses the established rule language and publication lifecycle.
15. As a criterion author, I want High, Medium, and Low review priorities independent of Error, Warning, and Information validation severity, so that a rule's review importance does not alter its documentation or signing behavior.
16. As a reviewer, I want separate items when a report matches several criteria, so that different concerns can have different assignees and outcomes.
17. As a reviewer, I want the criterion and relevant findings shown with each item, so that I can understand why the report entered review.
18. As a clinician, I want ordinary review to start after signing, so that incomplete documentation does not continually generate ordinary review items.
19. As a review administrator, I want new or changed criteria to apply prospectively by default, so that publishing a rule does not unexpectedly populate the historical queue.
20. As a review administrator, I want to preview a retrospective run over a selected date range, so that I can inspect the matching population before creating review work.
21. As a reviewer, I want repeated evaluation to preserve an existing report-criterion item, so that retries and retrospective runs do not create duplicate work.
22. As a reviewer, I want evaluation failures and incompatible reports distinguished from non-matches, so that an unsuccessful evaluation cannot appear to have passed.
23. As a criterion manager, I want routing to the documenting clinician, a named eligible reviewer, or an unassigned queue, so that each criterion supports its intended workflow.
24. As a review-all user, I want to claim eligible unassigned items, so that I can take work from the shared queue.
25. As a review administrator, I want to change an existing assignee, so that absences or changes in responsibility do not strand review work.
26. As an authorized user, I want bulk claiming, assignment, and reassignment within my authority, so that queue administration does not require opening every item.
27. As an assigned reviewer, I want to complete each item individually, so that each outcome reflects a deliberate decision about that review.
28. As a reviewer, I want New, In review, Awaiting clinician, and Completed statuses, so that progress and outstanding responses are visible.
29. As an agency, I want configurable completion outcomes, so that findings can be classified using terminology meaningful to our quality process.
30. As an assigned reviewer, I want responsibility for completion and outcome changes to remain with me until reassignment, so that competing users cannot record conflicting conclusions.
31. As an authorized participant, I want a timestamped discussion on the review item, so that the clinician and reviewers can exchange context while the review progresses.
32. As a clinician, I want permitted comments and outcomes on my own reports visible throughout review, so that I can respond before the review is complete.
33. As an agency, I want a criterion to require independent review when appropriate, so that the documenting clinician can respond without closing their own review.
34. As a reviewer, I want priority and item age visible in the queue, so that I can choose what needs attention next.
35. As an assigned reviewer, I want a relevant signed amendment to return a completed item to me for re-review, so that my previous conclusion is reconsidered when its supporting information changes.
36. As a reviewer, I want the previous conclusion and relevant changes retained during re-review, so that I can understand the complete sequence of decisions.
37. As an agency, I want to choose whether an amendment that clears a criterion closes its item automatically or requires reviewer confirmation, so that closure follows agency policy.
38. As a clinician, I want an overdue unsigned draft identified after the agency's deadline, so that unfinished reports receive follow-up.
39. As an agency, I want the overdue deadline to default to 24 hours after call completion, with report creation as the fallback, so that a missing completion timestamp does not prevent follow-up.
40. As a reviewer, I want edits to leave the overdue clock intact, so that occasional changes do not remove unfinished reports from attention.
41. As a clinician, I want signing to resolve the overdue review item automatically, so that completion of documentation ends that follow-up.
42. As a clinician, I want cancelled calls normally completed with a cancelled disposition and signature, so that cancellation follows the ordinary documentation lifecycle.
43. As a review administrator, I want exceptional closure of an unsigned overdue item to require a recorded reason, so that exceptions are accountable and visible in statistics.
44. As a user, I want in-app indicators for assignments, requested responses, and reopened reviews, so that I can see work requiring attention.
45. As an analyst within my review scope, I want statistics over all eligible signed reports, so that I can compare flagged cases with the wider report population.
46. As an analyst, I want filters for review criteria and outcomes, so that I can relate review findings to clinical and operational patterns.
47. As a review administrator, I want unsigned workload and exceptions represented in workload statistics, so that unfinished documentation remains visible without entering signed clinical measures.
48. As an analyst, I want a basic builder with simple filters, one grouping, and standard summaries, so that I can answer routine questions without a complex BI tool.
49. As an analyst, I want starter views for call volume, operational times, case mix, and review workload, so that useful analyses are available immediately.
50. As an analyst, I want patient reports counted individually even when several belong to one incident, so that the counting unit matches the records being reviewed.
51. As an analyst, I want each report counted once per repeated category, so that multiple doses of the same medication do not inflate a report count.
52. As an analyst, I want to select first, last, minimum, or maximum for repeated numeric values, so that the value used for each report is explicit.
53. As an analyst, I want clear definitions of measures, denominators, units, and missing values, so that I can interpret a visualization correctly.
54. As an analyst, I want custom elements available according to their types and permissions, so that local clinical fields can be analyzed alongside standard elements.
55. As a catalog administrator, I want new custom elements to become analytical rows without a schema change for each field, so that local definitions can evolve through the normal catalog workflow.
56. As an analyst, I want custom values to retain their definition, occurrence, and grouping identities, so that repeated and historical answers retain their meaning.
57. As an analyst, I want statistics to reflect effective signed amendments, so that results use the current signed record.
58. As an analyst, I want visible analytical freshness and refresh behavior, so that recently signed or amended reports are not assumed to appear immediately.
59. As a user, I want to save personal analyses, so that I can return to common questions without rebuilding their filters.
60. As a review administrator, I want to publish shared analyses, so that the organization can reuse useful views.
61. As a recipient of a shared analysis, I want it evaluated within my own permissions, so that sharing a definition never shares additional report access.
62. As an analyst, I want to export a visualization's aggregate values as CSV, so that I can use its results elsewhere.
63. As an analyst, I want to export the underlying report records as CSV, so that I can inspect or further analyze the population behind a visualization.
64. As an analyst, I want both exports to use the visualization's filters and data state, so that exported records reconcile with the displayed results.
65. As a user, I want exports to identify the selected real or synthetic dataset, so that demonstration records are not mistaken for operational activity.
66. As a user, I want real and synthetic datasets separated, with real records as the ordinary default and synthetic records as the demo default, so that demonstration activity does not distort operational statistics.
67. As an installation operator, I want analytical queries to use the existing projections and a reporting replica when configured, so that the review feature fits the established database architecture.
68. As a review administrator, I want recoverable processing failures and unavailable assignees visible, so that review work does not silently disappear.

# Implementation Decisions

## Approved module boundaries

The user confirmed these six boundaries and testing for all six:

1. **Access and privacy.** Resolve report scope, identifying access, administrative authority, and role defaults. Expose a consistent authorization boundary used by queues, report views, mutations, analysis, and export. Integrate with existing roles and capability prerequisites.
2. **Criterion execution.** Reuse published validation bundles for ordinary review and coordinate signing, amendment, overdue, and retrospective evaluation. Return versioned findings or explicit failures and create or reconcile review items idempotently.
3. **Review workflow.** Own item identity, assignment, routing settings, state transitions, outcomes, comments, history, independent-review checks, and in-app attention indicators. Accept authorized commands with concurrency control.
4. **Analytics projection.** Extend the existing projector and analytical dictionary to provide consistent custom occurrence rows, scoped report metadata, effective amendment lineage, freshness, and rebuild support.
5. **Analysis and exports.** Validate a small analysis definition, apply scope and dataset selection, calculate aggregates, provide the underlying report population, manage personal/shared definitions, and produce matching CSV exports.
6. **Review workspace.** Integrate the selector, queues, report viewer, review actions, settings, analysis builder, saved views, exports, and notifications using the established application components and localization conventions.

These are behavioral boundaries rather than a requirement to create six independently deployed services. Shared code should encapsulate rules behind stable interfaces rather than spread permission, counting, or lifecycle logic across screens.

## Access, roles, and privacy

| Capability | Meaning |
| --- | --- |
| review-self | Review the current user's documented reports and statistics within the feature's signed-report and overdue-draft populations. Assignment is not a prerequisite for this read scope. |
| review-all | Review eligible reports throughout the current organization and claim eligible unassigned items. |
| review-admin | Manage assignments, routing, review configuration, retrospective runs, shared analyses, and exceptional overdue closure. |
| review-identifying | Reveal permitted identifying content within the user's existing report scope; never expand that scope. |

- The names above record the agreed product capabilities. Integrate their machine identifiers consistently with the existing capability registry and role model, whose current keys use colon separators. Do not introduce parallel aliases or direct user grants.
- Default protected-role updates: Clinician includes self-review; Reviewer includes organization-wide review; Review administrator includes organization-wide review and review administration. Enable the currently reserved Reviewer role through the existing lifecycle.
- The demo user's role includes review-all, review-admin, and review-identifying. Apply this through the normal fixture and role mechanisms so the demonstration workflow remains reproducible.
- Identifying access is an explicit role grant. Ordinary Reviewer and Review administrator defaults do not imply it. Identifying permission alone is not a report scope.
- Existing validation read/write/publish capabilities continue to govern criterion authoring and publication. Review administration permits routing and workflow management without automatically authorizing changes to validation logic.
- Organization and documenting-user scope must be enforced server-side for every read and mutation, including indirect paths such as shared views, aggregate filters, result counts, exports, and media retrieval. Assignment cannot expand report access.
- The existing analyst database roles restrict accessible views but are not a substitute for application user and organization scope. Extend projected metadata and authorized query contracts where necessary to enforce scope and synthetic selection on the analytics connection.
- Recheck current application authorization for queries, mutations, and downloads. A saved analysis, stale browser state, or reporting replica must not preserve revoked access.
- Apply both catalog identifying classifications and the agreed clinical-free-text/media restrictions. The non-identifying experience withholds restricted values, filter options, narratives, photos, and audio, including on the clinician's own reports in Review mode.
- Shared discussion remains subject to the same identifying boundary. As an implementation inference, unrestricted review comments are potentially identifying and must not create a bypass. Structured statuses and outcomes must remain usable within the non-identifying experience.
- Replace the existing presentation-mode assumption that every non-clinical capability grants Admin mode. Explicitly classify clinical, review, and administrative capabilities; authorize each panel separately.
- Real and synthetic records are separate selectable datasets. Ordinary users default to real records and the demo user to synthetic records. Dataset selection is an additional filter within authorization, not a permission grant.

## Criteria and evaluation

- Extend the established validation rule editor and immutable publication lifecycle. A review-target rule has a High, Medium, or Low review priority separate from Error, Warning, or Information validation severity. A rule can participate in documentation/signing and review without coupling the two classifications.
- Reuse the evaluator's existing assertion and finding semantics. A review item corresponds to a finding produced by a review-target criterion; do not silently invert the rule language when presenting criteria.
- The durable unit is a patient report plus a stable criterion identity. Several matching occurrences for the same criterion belong to the same item with their occurrence context retained. Different criteria produce different items for the same report.
- Record the report's signed state, effective amendment sequence, criterion identity, rule version, evaluation time, and relevant findings. Later evaluation must not overwrite the evidence supporting an earlier conclusion.
- Ordinary evaluation follows signing and signed amendments. Prospective evaluation selects an applicable published review configuration and records that choice separately from the report's pinned signing validation. Later review must not rewrite historical signing results.
- A new or changed criterion does not automatically scan historical reports. A review administrator can request a date-bounded preview and deliberately start the corresponding retrospective run. Counts must identify matches, existing items, and evaluation failures or incompatibilities sufficiently to understand the work being created.
- Reuse compatible historical definitions and occurrence identities. The current evaluator requires a published bundle compatible with the report's pinned catalog. Incompatible or unavailable definitions must be surfaced as unevaluated/failed cases rather than counted as non-matches.
- Use bounded, durable, retryable processing consistent with the existing outbox/projector architecture. This is an implementation decision: review generation must be recoverable without making successful clinical signing depend on queue processing finishing synchronously.
- Enforce unique item identity and replay-safe commands. Concurrent evaluations, retries, and repeated retrospective runs must not create duplicate items, duplicate assignments, or repeated reopen events for the same evidence.
- Failures must remain distinguishable from passed evaluations and be visible to authorized administrators. A worker failure cannot silently remove an existing review concern.

## Routing and review lifecycle

- Each criterion supports automatic routing to the documenting clinician, a named eligible reviewer, or an unassigned queue. The default is unassigned.
- Criteria can require independent review separately from priority. The documenting clinician may respond but may not complete an item requiring independent review. Routing and claim validation must honor this requirement.
- A review-all user can claim an eligible unassigned item. Assigning another person or changing an existing assignee requires review-admin. Completion and outcome changes belong to the assigned reviewer; an administrator takes over through reassignment.
- Bulk claim, assignment, and reassignment apply authorization, eligibility, independence, and current-state checks to each affected item. Return explicit results for stale or ineligible selections. Complete reviews individually.
- Use fixed workflow statuses: New, In review, Awaiting clinician, Completed. Completion records an agency-configured outcome. Example outcomes from the interview are No concern, Documentation issue, and Care concern; they are examples rather than clinical classifications imposed on every agency.
- Preserve the meaning of historical outcomes when configuration changes. An outcome used by completed reviews cannot disappear from their history or change meaning retroactively.
- Keep a timestamped shared discussion and attributable history for assignment, status, outcome, policy-driven closure, and re-review. Authorized clinicians see permitted discussion and outcomes on their own reports throughout the review.
- High, Medium, and Low affect queue sorting, filters, and highlighting. Show item age. General priority-based deadlines, reminder schedules, and escalation rules are outside this release.
- If a signed amendment changes information relevant to a completed criterion and the report still matches, reopen the same item for its assigned reviewer. Preserve the previous conclusion and highlight relevant changes subject to data permissions.
- If the criterion's relevant input is unchanged, leave a completed review closed. Include relevant occurrence membership and absence states when determining whether its inputs changed; comparing only display text is insufficient.
- If an amendment clears the criterion, apply the agency's closure setting: reviewer confirmation by default, or automatic closure with an explicit recorded reason. This setting concerns ordinary criterion clearance and does not replace automatic resolution of an overdue item on signing.
- As a recovery inference, if the retained or configured assignee becomes ineligible, return the work to the unassigned queue with an administrative indicator and preserved history. Never broaden that user's authority or silently discard the item.
- Provide in-app counts and indicators for new assignments, requested clinician responses, and reopened reviews. Do not assume email delivery exists.

## Overdue unsigned drafts

- Ordinary unsigned drafts do not enter clinical BI or ordinary criterion queues. The overdue workflow is the specific exception for review access to unfinished documentation.
- The agency-configurable deadline defaults to 24 hours after call completion. Use report creation when completion is missing. Subsequent editing does not reset the clock.
- Detect overdue reports through authorized operational data and bounded scheduled processing. The feature can act only on drafts known to the server; offline changes enter this workflow after synchronization.
- Represent follow-up using the review workflow's assignment, discussion, history, and workload reporting. Avoid creating another overdue item on every scheduler run for the same report.
- Signing automatically records Resolved by signing and closes the overdue item, preserving its history. It also triggers ordinary evaluation of the signed report.
- Cancelled calls normally receive a cancelled disposition and are signed. Cancellation alone does not silently resolve an unsigned draft.
- A review administrator may exceptionally close an overdue item without signing, with a mandatory recorded reason. The report remains unsigned, and the exception remains visible in review statistics. This action does not sign, delete, or amend the clinical record.
- The exact representation of the overdue rule is an implementation choice; its age calculation and operational source must not be forced into signed-only analytical views.

## Analytical data and custom elements

- Use the existing effective signed projections and analytical views. They represent the latest effective signed amendments; the original signing state and amendment chain remain the source for historical evidence.
- Clinical measures use signed reports. Review workload measures include review records, overdue unsigned items, and closure exceptions through an authorized operational or projected contract. Label their population and freshness separately when necessary.
- Preserve the existing production projector cadence of bounded batches every two minutes and the five-minute signed-to-analytical freshness target. Query through the API, using a reporting replica when configured. Expose freshness, refresh behavior, and processing delays honestly.
- Add review-related and scope metadata to an analytical contract only where required; keep the API and analyst database workload privileges explicit. Do not grant general access to private or transactional tables merely to support BI.
- Currently, the projector sends unmapped scalar custom values into JSON additions on the wide row, and repeated custom values into the long table. The approved change makes the long table the consistent analytical source for **all custom element occurrences**, including standalone scalars.
- A scalar custom field produces one occurrence row; repeated values produce several. Analytical storage in the long table does not change the clinical field's recurrence, form behavior, or catalog definition.
- Each custom row retains its stable element and occurrence identities, typed value, applicable codes and units, exceptional-value metadata, identifying classification, pinned definition/catalog context, report identity, and amendment/projection lineage.
- Preserve true group, parent, correlation, ordinal, and time relationships for grouped values. Support a legitimate report-level representation for standalone occurrences. The current long table requires group metadata, so this needs a one-time schema and projector adjustment; it must not invent clinical groups or timestamps to satisfy the old shape.
- New custom definitions add dictionary metadata and rows, not a new analytical column or per-field migration. Standard non-repeatable NEMSIS elements can retain their established wide projection.
- Extend field discovery to custom definitions with permitted operations determined by datatype, recurrence, units, and visibility. Historical retired definitions remain interpretable through pinned metadata; compatible identity does not authorize reinterpretation of old values under a changed meaning.
- Rebuild existing signed custom values through the established bounded replay/reconciliation mechanisms, including effective amendments and both identifying classifications. Define the compatibility treatment of old JSON additions during implementation; the new BI path must use a single authoritative custom representation and never count both copies.
- Preserve existing normalization and quality policies: source values remain available, approved conversions are additive and versioned, and unusual values are not silently removed or clipped. New clinical thresholds or normalization rules are not part of this feature.

## Basic analysis and exports

- Provide simple field filters, one grouping at a time, standard descriptive summaries, and saved definitions. The initial experience must remain basic.
- As a bounded implementation default for the agreed standard summaries, start with counts, percentages, categorical distributions, and applicable numeric summaries such as mean, median, minimum, and maximum. Additional measures must justify their inclusion within the basic scope.
- Starter saved views cover call volume over time; response, scene, and transport durations; complaint, clinical impression, and disposition; and review workload by criterion, priority, status, age, and completion time. Keep them expressible by the same supported analysis definitions.
- Clearly define the start/end timestamps of operational intervals, units, denominators, inclusion rules, and missing values. The interview selected these measure families, not particular clinical thresholds or a new timing standard. Use existing canonical definitions where available and document the concrete mappings in the implementation.
- The default counting unit is a **patient report**, not an incident. Multiple patient reports belonging to one incident count separately. Interface wording must make this unit clear even where the familiar word call is used.
- For repeated categorical values, count a report once per category. A report may belong to several categories, so percentages across non-exclusive categories may exceed 100%; make that interpretation visible.
- For repeated numeric values, require an explicit per-report choice of first, last, minimum, or maximum. Define first/last ordering from available occurrence and mapped time metadata with deterministic tie handling. Do not invent clinical chronology for non-temporal groups.
- Missing values and explicit absence states must not become numeric zero. Expose the eligible denominator and excluded/missing count for measures where they affect interpretation. Do not combine incompatible units silently.
- Save personal analysis definitions. Review administrators can publish shared definitions. Sharing stores the definition, not another user's result rows or access; evaluate it under the current viewer's permissions and dataset.
- Each visualization supports aggregate CSV and underlying-record CSV. Apply identical population filters, repeated-field reductions, report scope, identifying restrictions, dataset selection, and data lineage to the visualization and its exports.
- Underlying exports use one row per contributing patient report and include selected permitted structured fields and the values needed to explain the visualization. Represent multi-valued categories without multiplying patient-report rows; use the agreed reducer for repeated numeric values.
- Ensure exports reconcile with what is displayed when projections or review outcomes change. Implement a consistent result/version boundary or explicitly refresh the visualization and its exports together; do not silently export a different population from the displayed result.
- Include enough export context to identify the selected real/synthetic dataset, measure, filters, grouping/reducer, and data freshness. Recheck authorization when generating or retrieving an export. Use safe CSV serialization for user-authored text.
- Bound query and export work for the repository's existing scale expectations. Use pagination or bounded export processing as needed; never silently truncate a dataset while presenting an export as complete.

## API and interface contracts

- Review context returns available modes, effective capabilities, dataset defaults, and permitted review actions.
- Review navigation contains Review queue, Analysis, and administrator-only Settings. The standalone Reports tab and signed-report list endpoint are removed; report detail and media endpoints support queue inspection.
- View replaces the queue with the full read-only report and its findings sidebar. Queue entries provide the signed/draft context so report and review-item requests can start independently. The loading view can be closed, and closing the full report restores the queue and keyboard focus.
- Review-reason descriptions appear only while hovering the reason name. Hover colors and tooltips clear on pointer exit, and touch interactions do not leave hover styling active.
- Queue and detail queries accept supported filters and pagination and return authorized items, criterion context, permitted report content, history, and available actions.
- Workflow commands cover claim, assign/reassign, status changes, completion/outcome updates, discussion, and the authorized overdue exception. Commands identify the expected item version and actor; stale updates produce a recoverable conflict.
- Criterion evaluation contracts distinguish evaluation evidence from mutable workflow state and expose the report, amendment, and rule versions used.
- Retrospective preview/run contracts bind a selected criterion configuration, date range, dataset, and scope. Execution revalidates authority and reports discrepancies or failures explicitly.
- Analysis field discovery returns only usable fields and permitted operations. Analysis requests carry a validated definition and dataset; responses carry results, population/denominator information, freshness, and the context needed for matching exports.
- Saved analyses distinguish personal definitions from published shared definitions. Export contracts distinguish aggregate and underlying-record CSV while retaining the same authorized analysis context.
- Reuse the current report presentation and catalog labels for read-only review, including the relevant occurrence context and amendment changes. Keep review actions and discussion easy to reach while inspecting a report.
- Integrate Review with existing localization, feedback diagnostics, navigation persistence, and accessibility. Browser-held presentation or analysis settings are preferences rather than authority to retrieve clinical data.

# Testing Decisions

The user approved testing **all six modules**. Good tests verify externally observable behavior and durable invariants rather than mirroring helper functions, implementation structure, or source text. Use real database coverage where constraints, grants, typed projections, or concurrency determine the behavior, and browser coverage for representative integrated workflows.

## Access and privacy

- Exercise own-report scope, organization-wide scope, review administration, identifying access, and relevant combinations through actual API behavior.
- Verify cross-user and cross-organization denial for queues, report details, mutations, criterion-derived populations, aggregates, saved views, media, and both export types.
- Verify that assigning or sharing never broadens scope, identifying access alone gives no report scope, and revoked permissions are enforced on subsequent requests/downloads.
- Verify non-identifying views cannot leak restricted content through clinical free text, custom fields, comments, filters, counts based on prohibited filters, or exports.
- Verify role defaults and demo fixture capabilities, explicit mode visibility, and real/synthetic defaults. Extend existing role-authoring, user-role-assignment, presentation-mode, and PostgreSQL workload-role tests.

## Criterion execution

- Exercise signing-to-item generation, multiple criteria per report, several matching occurrences within one criterion, published-version lineage, and a rule with independent validation severity and review priority.
- Verify prospective activation and date-bounded retrospective preview/execution, including existing items, changed populations, incompatible pinned catalogs, evaluator failures, and disabled/unavailable configurations.
- Verify retries, concurrent workers, and repeated runs do not duplicate items or reopen events. Verify delayed processing remains observable and recoverable after signing succeeds.
- Use the existing validation-authoring, review-evaluation, signing, amendment, and outbox/projection tests as prior art.

## Review workflow

- Exercise each routing option, eligible self-claim, administrator reassignment, per-item bulk results, and concurrent claims with one successful assignee.
- Verify fixed status transitions, configured outcomes, assigned-reviewer-only completion/outcome changes, visible shared feedback within permissions, and independent-review enforcement.
- Verify relevant amendment re-review, irrelevant amendment stability, preserved history, both agency-configured clearance behaviors, and unavailable-assignee recovery.
- Exercise overdue boundaries with a controlled clock: call-completion timestamp, creation fallback, the default and configured deadline, edits that do not reset age, repeated scheduler runs, signing resolution, signed cancellation, and exceptional unsigned closure with a required reason.
- Verify in-app indicators correspond to actionable assignments/responses/reopens and never reveal inaccessible report content.

## Analytics projection

- Round-trip standalone and repeated custom scalar, coded, and grouped values into the long projection with their supported typed payloads, absence states, identifiers, group relationships, and privacy classifications.
- Verify adding another custom definition requires no new analytical column or migration. Verify a one-occurrence custom field remains single-valued in the clinical model.
- Verify original signed data plus add/replace/remove amendments produce the correct effective occurrence rows and do not mix pinned definition meanings.
- Test migration/rebuild against existing scalar JSON additions and long custom rows. Verify idempotent rebuild, interrupted-run recovery, no duplicate BI representation, and correct identifying/non-identifying access.
- Test scope/synthetic metadata, projection freshness, and supported reporting-replica access using actual database roles. Preserve existing source-value and additive-normalization contracts.
- Use the existing analytics generator, database role/integration, custom-group persistence, projection recovery, privacy, and scale tests as prior art.

## Analysis and exports

- Use small fixtures with hand-calculable results for every supported measure family, filter, grouping, and reducer.
- Include multiple patient reports for one incident, repeated doses of the same medication, multi-category membership, repeated numeric values with tied/missing times, missing/absence values, incompatible units, custom fields, and effective amendments.
- Verify one report per underlying export row and exact reconciliation between chart aggregates and contributing records for the selected population and version.
- Change source projections or review outcomes between display and export to prove coherent refresh/version handling. Exercise stale authorization and saved-view sharing under different users.
- Verify safe CSV serialization, declared dataset/context, complete bounded export behavior, and explicit failures instead of silent truncation.
- Use existing analytical mapping, quality/normalization, reporting-role, and production-scale fixtures as prior art. Add representative query-plan/load checks for the actual introduced access patterns rather than expanding unrelated performance testing.

## Review workspace and acceptance journeys

- Verify online-only Review navigation, correct mode visibility, queue filters and priority/age display, report inspection, discussion access, individual completion, bulk administration, and in-app indicators.
- Verify basic analysis creation, each starter view, personal saving, shared publication, dataset switching, and both CSV downloads. Cover accessibility, keyboard use, and existing supported languages.
- Administrator journey: author/publish a criterion with review priority; configure routing and optional independence with the appropriate permissions; sign matching reports; see the expected queue population; preview and execute a historical run without duplicates.
- Clinician journey: see personal reports/statistics, receive a self-review item, respond and complete where allowed, and remain unable to close an independently reviewed item or read another clinician's reports.
- Reviewer journey: claim an eligible item, inspect its permitted record, request a clinician response, complete with an outcome, and receive the same item for re-review after a relevant signed amendment.
- Overdue journey: age a draft beyond the configured deadline, preserve its overdue age through edits, sign it with the applicable disposition, and observe automatic resolution plus ordinary signed-report evaluation. Separately exercise the recorded administrative exception.
- Analytics journey: create a new custom field, document and sign scalar and repeated examples, project them without a field-specific schema change, filter/group them in BI, and download reconciling aggregate and record CSVs under both identifying permission levels.
- Demo journey: bootstrap the fixture, enter Review with all three requested review capabilities, use synthetic records by default, and exercise review administration and BI without mixing demonstration activity into the real dataset.

# Out of Scope

- Offline review queues, offline BI, or an offline export workflow.
- Email notifications, email reminder schedules, and general priority-based deadlines or escalation rules. The overdue-draft deadline remains in scope.
- Bulk review completion.
- Automatic historical queue population whenever a criterion is published; explicit retrospective runs are in scope.
- A full BI platform: unrestricted SQL, a general formula language, complex multi-dimensional builders, or external data-source integration.
- External incident-reporting systems, hospital outcome feeds, or other integrations mentioned only in the historical reference document.
- Signing another clinician's report, deleting a clinical report through review, or changing clinical content merely by completing a review item.
- Altering clinical recurrence to match analytical storage, or adding an analytical column for every new custom definition.
- New clinical quality thresholds, normalization policies, or replacement of the existing validation language and publication model.

# Further Notes

- This PRD records the design interview and the subsequent custom-element analytics refinement on feature/review. The branch was created from the fetched main commit a9c1c21. Module boundaries and testing for all six were explicitly confirmed before writing this document.
- The reference PDF contributed the report-criterion work-item model, routing, shared queues, and contextual report review. Its historical instructions and examples were not treated as current implementation mandates.
- The interview initially placed broad assignment authority under review-all; the user's request for review-admin superseded that proposal. Review-all retains eligible self-claim, while administrative assignment/reassignment and automatic routing require review-admin.
- The demo user's identifying access was explicitly added later in the interview. The final fixture requires review-all, review-admin, and review-identifying.
- Terminology was resolved explicitly: the analytical unit called a call in conversation is a patient report, while an incident may contain several patient reports.
- Repository foundations already include review-target evaluation with immutable observations, versioned validation definitions, analytical wide/long projections, a retryable projector, approved analytical privacy/normalization policies, and reporting-replica verification. They require integration and extension, not parallel replacements.
- The approved architecture now supersedes scalar custom JSON additions as the new BI source. The one-time projection transition and compatibility treatment of existing analytical consumers need an explicit implementation plan and verification before removal of any legacy representation.
- Implementation inferences are identified above: durable asynchronous review generation, safe recovery for ineligible assignees, conservative treatment of unrestricted discussion, and a bounded initial descriptive-measure set. They support the agreed behavior without adding a broader product workflow.
- Remaining technical details to settle during implementation include historical catalog compatibility, precise operational-time mappings, deterministic ordering where repeated groups lack clinical time, the chart/export consistency mechanism, and CSV representation of multi-valued or opaque custom types. Unsupported operations must be explicit rather than silently coercing data.
- The main delivery risks are row-scope leaks through analytics and exports, duplication or lost history during re-evaluation, incorrect amendment lineage, lost custom grouping/absence information, stale analytical populations presented as current, and scope growth beyond basic BI. The approved tests target these risks.

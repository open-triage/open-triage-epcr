> **Implemented; current selector clarified 2026-10-08.** The Metric and Rule
> libraries share Validation authoring/publication and feed Analytics. The current
> picker offers Records and enabled, Review-enabled configured metrics/rules;
> raw recorded fields remain available for supported grouping and filtering.
> See the [metric runbook](../runbooks/metric-library.md) for actual calculations,
> evaluation limits, and the unresolved mappings that keep the trauma-destination
> and aspirin example rules disabled.

# Problem Statement

Agencies need to define the quantities and clinical checks used in Analytics and Review without changing application code. The existing Validation authoring workflow supports Boolean rules, but it cannot define a reusable continuous quantity such as a clinically meaningful time interval. Its finding-only evaluation results also cannot establish the eligible population for a rule's pass or failure rate.

The current analytical field catalog and predefined intervals are insufficient for agency-authored calculations. Defining a separate quantity for each aggregation would duplicate clinical logic: the same interval should support a mean, a percentile, or another compatible aggregation selected in Analytics. Agencies also need to use that interval in a Boolean validation rule when a threshold should produce an error, warning, or review finding.

Metrics and rules must remain together in the existing Validation configuration workflow and canonical JSON. Separately published libraries could leave a rule referring to a changed calculation and make historical findings difficult to reproduce.

# Solution

Extend Validation configuration with a **Metric library**, including its metric editor, above the existing **Rule library**. There are exactly two kinds of authored definitions:

- **Metrics** produce continuous numeric values, including durations and numeric differences.
- **Validation rules** evaluate Boolean conditions and retain the current applicability, severity, execution-target, message, and review-priority behavior. Rules may reference metrics to turn numeric results into validation errors, warnings, or review findings.

Store both libraries in the same canonical JSON and publish them under one shared Validation version. Reuse the existing draft, validation, publication, activation, import/export, and history workflow. There is no separate metric configuration pane, metric package, or independent metric version lifecycle.

Analytics allows users to select configured metrics and rules with Review enabled. Metrics use continuous-value aggregations; Boolean rules support outcome counts and percentages. The aggregation choice remains in Analytics, including mean and 90th percentile for a single interval definition. Review continues to use Boolean rule findings and existing routing.

Use measure families 3 through 10 from the 2009 EMS performance-measures document as the initial definition targets. These exercise interval calculations, selection of qualifying repeated observations, differences between observations, and Boolean checks over an eligible report population.

# User Stories

1. As an agency administrator, I want a Metric library above the Rule library on the Validation configuration page, so that I can manage related calculations and checks in one place.
2. As an administrator, I want to create a continuous numeric metric, so that my agency can analyze a quantity that is not a directly recorded field.
3. As an administrator, I want metrics and rules to remain the only two definition kinds, so that I can distinguish quantities from Boolean checks.
4. As an administrator, I want to name and describe a metric and declare its unit, so that users understand its meaning and interpretation.
5. As an administrator, I want to define which reports qualify for a metric, so that its result describes the intended population.
6. As an administrator, I want to calculate an interval between explicitly selected clinical events, so that similarly named intervals cannot conceal different endpoints.
7. As an administrator, I want to select the first or last qualifying observation by clinical time, so that calculations reflect the intended event sequence.
8. As an administrator, I want related values, codes, and timestamps to remain attached to their recorded occurrence, so that a calculation cannot combine unrelated procedures or observations.
9. As an administrator, I want to calculate a numeric difference between selected observations, so that I can analyze change during an encounter.
10. As an administrator, I want catalog-aware element and code assistance, so that I can author definitions against valid standard or custom fields.
11. As an administrator, I want syntax, reference, datatype, and unit diagnostics while editing, so that I can fix an invalid calculation before publication.
12. As an administrator, I want an explanation of the metric's calculation and eligibility, so that I can review its intent alongside its expression.
13. As an administrator, I want to enable or disable a metric without losing its identity or history, so that policy changes remain auditable.
14. As an administrator, I want a Review-enabled setting for metrics, so that I can choose which configured quantities are available in Analytics.
15. As an administrator, I want a Boolean rule to reference a metric, so that one calculation can support both analysis and validation.
16. As an administrator, I want to configure a rule's threshold, message, severity, and targets using the existing workflow, so that a metric can support appropriate errors, warnings, and review findings.
17. As an administrator, I want a metric to produce no findings by itself, so that measuring a quantity does not automatically interrupt clinical work or create review work.
18. As an administrator, I want to see which rules depend on a metric, so that I can understand the effect of editing or disabling it.
19. As an administrator, I want publication to reject broken enabled dependencies, so that the published configuration is executable as a whole.
20. As an administrator, I want metrics and rules saved in the same canonical JSON, so that configuration can be reviewed and transferred as one complete definition.
21. As an administrator, I want both libraries to share one draft revision and published version, so that dependent definitions cannot drift independently.
22. As an administrator, I want cloning, publication, activation, and rollback to include both libraries, so that the existing lifecycle remains consistent.
23. As an administrator, I want existing rule-only definitions to remain usable, so that adding metrics does not invalidate installed configuration.
24. As an administrator, I want source provenance and agency modifications preserved, so that starter definitions remain distinguishable from local policy.
25. As an administrator, I want to start from the EMS measure families 3 through 10, so that the new capabilities support concrete analytical and review needs.
26. As an administrator, I want incomplete or incompatible starter definitions clearly identified, so that unresolved mappings are not mistaken for working agency policy.
27. As an administrator, I want changes in either library preserved while I switch editors, so that I can revise a metric and its dependent rules together.
28. As an administrator, I want the existing Validation capabilities to govern both libraries, so that this feature respects the established authoring authority.
29. As an analyst, I want to select any configured metric or rule with Review enabled, so that my choices reflect agency configuration.
30. As an analyst, I want configured definitions to remain discoverable when they have no matching observations or findings, so that an empty result does not hide available policy.
31. As an analyst, I want to choose an aggregation separately from a continuous metric, so that I can examine the same quantity in different ways.
32. As an analyst, I want a 90th-percentile aggregation alongside the existing continuous aggregations, so that I can analyze interval distributions without duplicate definitions.
33. As an analyst, I want counts and percentages of applicable Boolean rule outcomes, so that I can measure compliance or exceptions with an explicit denominator.
34. As an analyst, I want the selected pass or failure outcome clearly labeled, so that a failure rate cannot be mistaken for a success rate.
35. As an analyst, I want excluded, incomplete, invalid, and failed evaluations shown separately, so that an apparently favorable result cannot conceal missing evidence.
36. As an analyst, I want each report counted consistently despite repeated observations, so that multiple measurements do not inflate a rate.
37. As an analyst, I want configured definitions to work with the existing dates, grouping, filters, and visualizations, so that agency-authored calculations fit the current Analytics workspace.
38. As an analyst, I want aggregate and underlying-record exports to identify the definition and version used, so that I can reconcile exported results with the displayed analysis.
39. As an analyst, I want all results and exports to respect my agency, report permissions, and dataset, so that configuration does not broaden access to clinical information.
40. As a clinician, I want metric-dependent rules to behave consistently in the browser and on the server, so that a calculation does not change when I sign a report.
41. As a clinician, I want the existing error, warning, and acknowledgement behavior retained, so that metric-dependent checks follow familiar validation rules.
42. As a clinician, I want an acknowledgement to reflect the metric's contributing inputs, so that a changed clinical value cannot retain a stale acknowledgement.
43. As a reviewer, I want a metric-dependent finding to identify its value and contributing observations, so that I can understand why the rule matched.
44. As a reviewer, I want current routing, priority, and amendment behavior preserved, so that metric-dependent criteria fit the existing review workflow.
45. As an auditor, I want the shared definition version and report revision recorded with an evaluation, so that historical results remain reproducible.
46. As an auditor, I want later analysis to remain separate from the report's pinned clinical configuration, so that retrospective calculations do not rewrite what was signed.
47. As a keyboard or assistive-technology user, I want both libraries and editors to have accessible controls, errors, and focus behavior, so that I can complete the authoring workflow.
48. As a mobile user, I want the libraries and editors to remain usable at small widths and enlarged text, so that required controls are reachable.

# Implementation Decisions

## Confirmed product boundaries

- Exactly two authored definition kinds: continuous numeric metrics and Boolean validation rules. Boolean values, categories, distributions, percentages, and population summaries are not additional metric-definition types.
- The Metric library and its editor are above the Rule library on the existing Validation configuration page.
- Both libraries live in the same canonical JSON and share versioning. A published rule resolves metric references within that shared immutable version.
- Validation rules may reference metrics and keep their current Boolean rule model.
- Analytics offers configured metrics and rules with Review enabled. Continuous aggregation, including mean and 90th percentile, belongs to the Analytics aggregation selector.
- Initial starter coverage is the EMS measure families 3 through 10.

The remaining choices below are implementation decisions inferred from these requirements and the existing repository. They are not additional product decisions attributed to the user.

## Modules and interfaces

Use four substantial modules with narrow, testable boundaries:

| Module | Responsibility | Interface boundary |
| --- | --- | --- |
| Shared expression compiler and evaluator | Parse, explain, type-check, and evaluate continuous metrics and Boolean rules; select correlated observations; resolve metric references; produce result evidence | A catalog-bound definition and report document enter; compiled artifacts, diagnostics, and deterministic evaluation results leave |
| Authoring API and version lifecycle | Manage both libraries as one canonical configuration, including dependencies, revisions, permissions, history, publication, import/export, and activation | One revision-checked draft or canonical package enters; one validated or published shared version leaves |
| Validation configuration page | Present Metric library and editor above Rule library, with reference assistance, diagnostics, dependency visibility, and protected drafts | Shared version state and authoring capabilities enter; edits and lifecycle commands leave |
| Analytics and Review integration | Discover configured review-enabled definitions, evaluate authorized report contributions, aggregate and export results, and feed metric-dependent rule findings into existing Review | A version-resolved selection and authorized report scope enter; coherent analytical results, contributions, or review findings leave |

Starter definitions are authored content consumed by these modules. They do not require a separate execution engine or a hardcoded route per measure.

## Canonical configuration and shared lifecycle

- Extend the canonical Validation document with a metrics collection alongside its rules collection. Each item has a stable identity within its kind. The document retains one configuration identity, catalog binding, draft revision, publication history, and shared version number.
- Include both collections in canonical serialization, content integrity checks, compiled integrity checks, import/export, and change history. A metric-only edit creates a new shared version when published.
- Published metric references resolve to the metric identity in the containing Validation version. Runtime evaluation must not resolve a reference through a mutable latest-metric lookup.
- Reuse the existing draft save, validate, publish, activate, and reactivate operations. Activation continues to verify the compatible Form, Catalog, and Validation configuration; it does not acquire a second metrics activation operation.
- Preserve existing reports' pinned versions and installed immutable publications. Updating installation definitions or importing a package does not rewrite their historical configuration.
- Accept supported legacy rule-only documents as definitions with an empty metrics collection. Explicitly version new serialized and compiled capabilities; unsupported consumers must reject them rather than discard metrics or reinterpret dependent rules.
- Recompile imported definitions locally against their catalog dependency. Validate both libraries and their references before committing a shared publication. Preserve the existing separation between publication and activation.
- Retain the existing rule disablement/history convention for metrics. An enabled rule may not depend on a missing, disabled, invalid, or catalog-incompatible metric. Disabled unfinished definitions may be retained under the existing draft/publication conventions when no enabled definition depends on them.
- Extend persistence and API contracts for metric definitions, metric library entries, diagnostics, dependencies, and change summaries. Reuse the current Validation version ownership and authorization boundary. No independently versioned metric registry is introduced.
- Apply the existing Validation read, write, and publish capabilities to both libraries, including the established Demo restrictions and optimistic concurrency behavior.

## Continuous metric definitions

- A metric declares its stable identity, name, description, enabled state, Review-enabled availability, unit, optional applicability, numeric expression, and provenance. Apply the application's established English/Swedish wording conventions.
- One applicable report produces one numeric contribution for a metric. Expressions may select and reduce repeated observations to obtain that contribution, but they do not emit a collection of observations as the metric's public result.
- Continuous numeric quantities include durations, measured values, and numeric differences, even where the documented inputs use integer scales. A metric cannot be a Boolean check encoded as zero/one or a category encoded as an arbitrary number.
- Support the smallest bounded expression surface needed for the starter definitions: typed numeric inputs, explicit event selection, first/last qualifying observations, compatible numeric differences, elapsed time, and Boolean applicability predicates.
- An interval definition identifies both endpoints and their selection conditions. It does not contain an agency-wide mean, percentile, percentage, time bucket, chart, or population query.
- Select procedure, medication, and vital values with their associated codes, timestamps, and group ancestry. A qualifying code from one occurrence must not select a timestamp or value from another occurrence.
- Clinical event selection uses clinical timestamps. Missing timestamps or ambiguous ordering are reported explicitly when they prevent the intended calculation; the generic analytics fallback to occurrence order must not silently substitute for clinical chronology. Define and test a deterministic tie policy for equivalent timestamps.
- Return numeric results with a declared unit. Enforce compatible inputs; reject unsupported conversions and non-finite results. A negative numeric difference may be valid, while a negative elapsed duration is invalid for the starter interval definitions.
- Metrics use report-domain inputs and explicit evaluation context. No database queries, network calls, cross-report calculations, arbitrary scripts, or recursive evaluation are available to authors.
- In this delivery, metric expressions use report inputs; rules may depend on metrics. Metric-to-metric composition and dependencies on rule outcomes are outside scope.

## Boolean validation and metric dependencies

- Retain the existing optional applicability clause, required Boolean assertion, optional occurrence scope, primary target, severity, execution targets, message, and review priority.
- Add typed metric references usable in Boolean comparisons and availability checks. Show stable metric identities with readable names and units in the existing reference assistance.
- A metric has no severity, acknowledgement, review priority, or finding message. A consuming rule supplies these behaviors.
- Treat Review-enabled availability separately from calculation dependency. A metric needed by an enabled live or signing rule must be executable in that rule's context even when it is not exposed in Analytics. Validate and package those dependencies with the consuming rule.
- Extend element/reference checks through metric dependencies. Live and signing activation must verify that the metric's required inputs are available through the compatible form or approved platform sources.
- Include the required compiled metrics in offline/live bundles and in server-side signing/review evaluation. Use the same evaluator semantics and resource limits in both environments.
- Resolve each metric against the same effective report revision and amendment snapshot as the consuming rule. Reuse its result within that evaluation so multiple rules cannot observe different inputs.
- Metric unavailability must not coerce to zero, a passing assertion, or an invented clinical failure. Provide explicit Boolean availability checks so a rule can require a value or guard a comparison. An unhandled unavailable value in a required numeric comparison is an explicit evaluation failure; signing retains its existing fail-closed behavior.
- Preserve the established semantics of ordinary Boolean field checks and existing rule-only bundles. This feature must not globally redefine missing values or the current presence operators.
- Finding evidence includes the resolved metric identity, shared version, value/unit or failure reason, and contributing observations. Acknowledgement fingerprints include the underlying metric inputs; an unrelated field edit should not invalidate them.
- Preserve independent documentation severity and review priority. Existing errors block signing, warnings require acknowledgement, and Review priority controls queue behavior. Merely calculating a metric creates no finding or queue item.

## Evaluation results and rule denominators

- Expose evaluation results in addition to the existing finding output. A successful metric result contains a number and unit; a successfully evaluated rule result contains a Boolean. Eligibility, missingness, invalid input, and engine failure are evaluation metadata, not new authored definition types.
- For rule analysis, distinguish not applicable, applicable/pass, applicable/fail, and unavailable/failed evaluation. Preserve missing, recorded-absent, and invalid metric-input reasons where relevant.
- An explicit Boolean assertion about missing documentation can validly fail and belong in a rate. An unavailable numeric calculation is not automatically equivalent to that assertion. Denominators follow the authored applicability and the actual evaluability of the selected check.
- Count at most one contribution per report for the selected rule. For an occurrence-scoped rule, any applicable failing occurrence makes the report fail; at least one applicable occurrence with all applicable assertions passing makes it pass; no applicable occurrence makes it not applicable. An unresolved evaluation error cannot be reported as a reliable pass or fail. Retain occurrence evidence for explanation.
- Rule percentages use the selected pass or fail count divided by evaluable applicable reports in the same filtered group and bucket. Show the numerator, denominator, not-applicable population, and unavailable population. An empty denominator yields unavailable, not zero percent.
- Analytical outcomes are computed independently of whether a rule emitted a workflow finding. A disabled rule is unavailable; an enabled review-target rule remains analyzable even when its severity or review priority suppresses workflow findings. Priority None must continue to prevent review queue items.
- Never derive clinical rates from review queue size, assignments, completed-review status, or the presence of findings alone.

## Analytics discovery, aggregation, and exports

- The Analytics metric selector identifies Records, configured continuous metrics,
  and configured Boolean rules as distinct choices. Recorded fields remain
  available for supported grouping and filtering. Existing field-analysis backend
  contracts are retained, but do not add raw-field choices to this selector.
- In this PRD, Review enabled applies to both definition kinds. For rules it uses the existing review execution target; metrics expose the corresponding authoring option. Also require the definition to be enabled and published.
- Use the agency's active published shared Validation configuration as the default configured library. Resolve every selection to its definition kind, stable identity, shared version, and catalog binding. This is the implementation default; it does not introduce a separate historical-version management UI.
- Discover configured definitions from configuration rather than observed report values, matching findings, the selected date range, or queue population. A configured definition with no contributing data remains selectable and returns an explained empty result.
- Apply the existing authorized signed-report population, date boundaries, agency timezone, effective amendment handling, dataset separation, and freshness guarantees when evaluating contributions. Historical compatibility is checked explicitly; incompatible report catalogs are reported rather than silently reinterpreted.
- Continuous metrics use the existing mean, median, minimum, and maximum choices, with 90th percentile added to the compatible aggregation list. Compute aggregates over valid per-report contributions only, displaying unavailable and excluded counts alongside them.
- Use a documented deterministic percentile convention. The implementation recommendation is nearest rank: after sorting valid values, select position ceiling of 0.90 times the sample count, using one-based positions. Empty samples are unavailable. Include the convention in help/export metadata and lock it down with small fixtures.
- Boolean rule selections offer pass/fail outcome counts and percentages. Label the chosen outcome explicitly; do not offer numeric means or percentiles for Boolean rules, or create numeric proxy metrics for rate calculation.
- Preserve the existing Line, Bar, and Table presentations, dates, grouping, filters, time grouping, draft/applied-query separation, and Review/Analytics navigation state. Configuration membership is independent of the user's current analytical filters.
- Extend result and export contracts with the definition kind, stable identity, shared version, metric units or selected Boolean outcome, contributor states, and explanatory evidence within existing permissions. Preserve bounded execution and explicit size-limit failures.
- Bind aggregate and record-level exports to the same applied query, shared definition version, and source revision as the displayed result. Retain one underlying-record row per contributing or incomplete eligible report, with enough context to reconcile it to the displayed population.
- Default analytical evaluation has no review-queue side effects and does not alter a report's signed clinical configuration. Existing explicit retrospective review and amendment workflows continue to control queue changes.

## Validation configuration UI

- Keep the existing version workspace and shared draft/lifecycle actions. Place the Metric library, including its selected metric editor, above the existing Rule library and rule editor.
- Do not add a separate Administration navigation entry or an independent metric version selector. Saving, validating, publishing, importing, or activating the shared configuration affects both libraries.
- Provide a compact searchable metric list with identity/name, unit, Review-enabled state, enabled state, and validity. The editor presents description, applicability, numeric expression, catalog assistance, diagnostics, explanation, and dependent rules.
- Keep metric controls focused on quantities. Do not expose severity or review priority in the metric editor, and do not place aggregation or visualization controls there.
- Add metric references to rule-editor assistance without replacing the existing rule language or controls.
- Preserve unsaved edits across metric/rule selection and retain loaded library state on recoverable refresh failures. Apply existing leave-with-unsaved-changes protection to the shared draft.
- Follow the repository UI style guide, agency colors, shared controls, localization, mobile-width behavior, and accessibility conventions. The existing long-page exception for Administration authoring applies; large libraries still need bounded lists.
- Keep the current Rule library interaction exception unchanged. Use the shared accessible list pattern for the new Metric library, including a named native edit/view action, independent embedded controls, visible selection, and keyboard focus.

## Initial definition coverage

The source baseline is [EMS Performance Measures, December 2009, printed pages 8–21](https://www.ems.gov/assets/EMS_Performance_Measures_2009.pdf). The table maps that baseline into the agreed two-kind model; aggregation is always selected in Analytics.

| Source measure | Initial definition target |
| --- | --- |
| 3 | PSAP-to-first-defibrillation interval |
| 4 | PSAP-to-initial-rhythm-analysis interval |
| 5 | Boolean trauma-center destination check for qualifying trauma |
| 6.1–6.3 | Numeric pain change, consumed by Boolean outcome checks |
| 6.4 | Boolean pain-intervention check |
| 7 | Boolean 12-lead performance check |
| 8 | Boolean aspirin-administration check for eligible chest pain |
| 9 | Boolean STEMI specialty-destination check |
| 10.1–10.6 | PSAP-to-patient-contact, patient-contact-to-scene-departure, and scene-departure-to-destination intervals |

The source uses older dataset identifiers; measures 5 and 9 are interim, and 6.4 is parked. Preserve those statuses and map the source explicitly to the bound catalog. Its age boundaries and some interval descriptions require interpretation; record those decisions with each template. The document remains the source for detailed eligibility and exclusions. [Source](https://www.ems.gov/assets/EMS_Performance_Measures_2009.pdf)

Implementation requirements for these templates:

- Author continuous interval definitions once. Their mean and percentile outputs must use the same per-report values and eligibility.
- Express rate measures through Boolean rules and outcome aggregation. For pain, choose a consistent subtraction direction and document which Boolean outcome supplies each rate.
- Keep thresholds, qualifying code sets, accepted destinations, age handling, and other local mappings in the authored configuration or its bound catalog. Do not hide them in metric-specific application code.
- Retain source identity and agency modifications in the canonical JSON. An agency adaptation must not silently replace its historical source definition.
- Initial clinical thresholds must be explicit agency configuration where the source supplies no threshold. Enabling a metric must not invent a threshold or enable signing restrictions.
- Preserve the existing operational interval definitions and their meaning. Introduce separately identified starter intervals where endpoints or eligibility differ.
- Retain unresolved templates as visibly disabled definitions with actionable diagnostics. In particular, the parked template requires explicit local completion before enablement. Do not guess missing code mappings or silently omit an unsupported source measure.

# Testing Decisions

The testing recommendation covers all four modules. This is the proposed verification scope, not a claim that implementation tests have already been written or run. Good tests verify externally observable behavior rather than internal representation or incidental implementation details.

## Shared expression compiler and evaluator

- Use small report fixtures with hand-calculable intervals and numeric differences. Cover scalar values, repeated-group ancestry, code/time correlation, first/last clinical selection, equal timestamps, missing endpoints, incompatible units, valid negative differences, invalid durations, and non-finite calculations.
- Prove that Boolean/category metric expressions and unsupported cross-report operations are rejected. Verify that valid metric-dependent Boolean rules compile, explain, and evaluate consistently in browser and server contexts.
- Verify unavailable-value handling, explicit availability assertions/guards, existing Boolean missingness semantics, fail-closed signing, resource limits, and legacy rule-only evaluation parity.
- Verify that metric evidence and acknowledgement fingerprints follow the contributing inputs and shared version, including changed relevant inputs and unchanged unrelated inputs.

## Authoring API and version lifecycle

- Round-trip a canonical JSON containing both libraries through save, publish, export, import, and clone. Verify stable identities, local recompilation, shared integrity, and correct dependency binding after import.
- Cover legacy rule-only packages, unsupported formats, corrupt content, disabled invalid definitions, enabled broken dependencies, catalog incompatibility, and stale draft revisions.
- Prove that a metric-only edit creates a new shared publication, that rollback restores the complete compatible configuration, and that already pinned reports and published versions remain unchanged.
- Verify that dependent live/sign metric inputs participate in form compatibility and offline packaging.
- Exercise organization isolation, existing Validation capabilities, Demo restrictions, and shared publication history using the same style of API/database integration fixtures as existing Validation authoring tests.

## Validation configuration page

- Use browser journeys to create and edit a metric, select it from a Boolean rule, save the shared draft, validate, publish, reload, and verify both definitions.
- Verify placement above Rule library, shared version/lifecycle controls, dependency diagnostics, Review-enabled controls, and preservation of edits when switching libraries.
- Cover retained lists on failed refresh, stale-save conflicts, unsaved-change protection, keyboard operation, accessible diagnostics, localized wording, mobile/enlarged text, and a nondefault agency palette.
- Inspect the changed UI in a browser. Source assertions alone do not establish layout or usability.

## Analytics and Review integration

- Prove that all configured enabled review definitions are discoverable even with zero observations, zero findings, or a date range with no eligible reports. Confirm that disabled and non-review definitions are not offered.
- Use hand-calculable populations for continuous aggregates, nearest-rank 90th percentile, Boolean pass/fail counts and percentages, zero denominators, incomplete inputs, not-applicable reports, and repeated-rule report deduplication.
- Verify that severity/priority None can suppress workflow findings without hiding a review-enabled definition from Analytics or losing its outcomes. Analytical queries must create no queue items.
- Exercise source measure templates with positive, negative, excluded, and incomplete examples, including exact interval endpoint selection. Validate all required local mappings before enabling a template.
- Verify authorized report scope, dataset separation, effective amendments, historical catalog incompatibility, timezone/date grouping, explicit size bounds, freshness, and display/export reconciliation under changing data or configuration.
- Cover existing review routing, immutable evaluation evidence, retrospective isolation, and amendment-driven re-review for a metric-dependent criterion.

Prior art includes the existing Validation authoring lifecycle and language suites, canonical-definition import/export tests, browser validation-authoring journeys, review worker and retrospective tests, and unified analytics calculation, database, browser, and CSV tests. Extend those patterns and shared fixtures where they test the introduced behavior; do not broaden unrelated suites solely for this feature.

# Out of Scope

- A separate Metrics configuration pane, independent canonical metric file, or separate metric version/activation lifecycle.
- Boolean, categorical, distribution, or percentage metric-definition types; numeric encoding of Boolean rule outcomes as substitute metrics.
- Aggregation, chart layout, or cross-report queries inside metric definitions.
- A new rule severity model, changes to existing clinical rule semantics, or automatic review findings produced by a metric alone.
- A visual drag-and-drop expression builder, arbitrary code/SQL, external-service calls, recursive expressions, or metric-to-metric composition.
- Changes to Review routing, assignments, completion, or permissions beyond integrating metric-dependent rules with existing behavior.
- Automatic reinterpretation of signed reports, silent rewrites of historical definitions, automatic activation of imported templates, or automatic historical queue creation from Analytics.
- Replacement of the current field-analysis catalog, Analytics workspace, or unrelated Administration UI redesigns.
- Clinical modernization of the historical measures beyond explicit catalog mappings and documented agency adaptations.
- Additional EMS measure families, scheduled reports, sharing, predictive analytics, or a general-purpose statistical platform.

# Further Notes

- This specification incorporates the user's final decisions: continuous metrics, Boolean rules, the Metric library above Rule library, one canonical JSON with shared versioning, and selection of configured review-enabled definitions in Analytics. It supersedes the earlier conversational suggestions of a separate Metrics pane, independent metric versions, or Boolean/category metric types.
- Existing Validation authoring and Unified Analytics specifications remain applicable except where this document explicitly extends their definition, expression, discovery, and aggregation contracts.
- Shared lifecycle is a product requirement. Defaulting Analytics to the active published configuration, one contribution per report, the scoped-rule reduction, and nearest-rank percentile are implementation decisions recorded here to make the initial delivery precise.
- The current review evaluator suppresses successful and inapplicable assertions from its finding list and skips rules whose review priority is None. The implementation needs an outcome-producing evaluation path for Analytics while preserving existing finding/queue behavior.
- Existing Analytics discovery depends on observed field values. Configured definitions require a configuration-backed discovery source; an empty historical population cannot be used as evidence that a definition is unavailable.
- Historical report evaluation must preserve exact shared definition and report/amendment identity. Whether results are computed on demand or materialized is an implementation choice, provided execution bounds, freshness, reproducibility, permissions, and export consistency hold.
- Exact serialized field names, parser syntax, storage layout, and query strategy remain implementation details. They must preserve the typed result boundary, shared canonical version, and current-report evaluation restrictions specified above.
- Unresolved source mappings and boundary interpretations must be documented per template during implementation and verified with fixtures. They do not justify inventing local policy or activating an incomplete definition.

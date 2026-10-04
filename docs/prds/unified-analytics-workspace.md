# Problem Statement

Users need one predictable set of analytics controls and one central visualization to explore authorized records and inspect results.

Users need to select a metric, a datatype-appropriate aggregation, explicit dates, a grouping, and documented filter values, then view and export the resulting analysis. Grouping and filtering choices must reflect what the agency has actually documented across its records, rather than a small fixed set of examples or only the records in the selected period.

The current large Review banner also provides no direct transition between reviewing records and analyzing them. This needs a focused change within the existing application, not a replacement application shell.

# Solution

Replace the existing large **Review** banner inside Review mode with a compact **Review / Analytics** selector. Review continues to display the current production Review workspace. Analytics displays the approved control-rail interface beneath the selector.

**Integration boundary:** integrate the analytics panel below the mockup's Review / Analytics selector, together with its element, value, and export dialogs. Replace the production Review banner with the selector. Do not copy the mockup's surrounding page, green session bar, branding, account avatar, demonstration agency header, preview badges, design annotations, footer, or illustrative Review queue. The current application's shell, global presentation selector, identity context, branding, and actual Review queue remain authoritative.

The [approved interactive mockup](../design/analytics-mockups/index.html) and [desktop preview](../design/analytics-mockups/analytics.png) are the sole visual references. The mockup demonstrates behavior with fictional records; its sample data, small metric list, JavaScript data engine, and simplified Review tab are not production implementations.

The analytics panel has one left control rail and one central result area:

1. Visualization: **Line**, **Bar**, or **Table**.
2. Metric: the quantity or documented element to analyze.
3. Aggregation: directly below Metric, with choices appropriate to its datatype.
4. Time period: always-visible custom **From** and **Through** dates.
5. Group by: one documented element, or **No grouping**.
6. Filters: searchable documented elements and their unique recorded values.
7. **Update visualization**: applies the complete set of choices.

For a line chart, a **Time grouping** dropdown beneath the chart offers **Day**, **Week**, and **Month**. This is separate from categorical grouping in the control rail. Groups become series within the same line chart. Bar and Table summarize the selected period using the selected categorical grouping.

One Export action in the result header offers aggregate CSV and record-level CSV for the displayed analysis. Compact population, completeness, units, and freshness information provide context without creating a second dashboard.

# User Stories

1. As a reviewer, I want the large Review banner replaced by a Review / Analytics selector, so that I can switch tasks within the current application.
2. As a reviewer, I want Review to retain the existing queue, filters, inspector, report view, and actions, so that introducing analytics does not change my review workflow.
3. As a user, I want the current application shell and global mode navigation retained, so that Analytics feels like part of the application I already use.
4. As a reviewer, I want my queue filters, page, selection, and scroll position preserved when I visit Analytics and return, so that I can resume my work.
5. As an analyst, I want my analysis controls and displayed result preserved when I visit Review and return, so that switching tasks does not reset my analysis.
6. As an analyst, I want one set of controls and one central visualization, so that my choices apply to a single result.
7. As an analyst, I want to choose Line, Bar, or Table, so that I can inspect trends, compare categories, or read exact values.
8. As an analyst, I want a metric picker separate from the aggregation picker, so that the quantity and the calculation are explicit choices.
9. As an analyst, I want mean, median, minimum, and maximum for continuous metrics, so that I can choose an appropriate descriptive summary.
10. As an analyst, I want count and percentage for discrete metrics, so that I can compare category frequency and share.
11. As an analyst, I want aggregation choices to change with the metric's datatype, so that I cannot accidentally average a categorical code.
12. As an analyst, I want a compatible aggregation preserved when changing metrics and an incompatible one clearly replaced, so that changes remain understandable.
13. As an analyst, I want metric units and any required repeated-value selection to be clear, so that the calculation has an unambiguous meaning.
14. As an analyst, I want custom start and end dates always visible, so that every analysis has an explicit period.
15. As an analyst, I want invalid or incomplete dates identified beside the controls, so that I can correct them before running an analysis.
16. As an analyst, I want Day, Week, or Month beneath a line chart, so that I can adjust the temporal resolution where I read the trend.
17. As an analyst, I want time buckets to respect the agency timezone and the selected dates, so that boundaries match operational reporting.
18. As an analyst, I want categorical grouping independent of time grouping, so that I can compare groups over time in one chart.
19. As an analyst, I want No grouping available, so that I can analyze the whole matching population.
20. As an analyst, I want grouping and filter elements drawn from what has actually been documented in agency records, so that the controls reflect the agency's data.
21. As an analyst, I want historical values to remain selectable when I change the analysis dates or other filters, so that narrowing a query does not hide possible choices.
22. As an analyst, I want searchable element and value pickers with recognizable labels, so that I do not need to type internal codes.
23. As an analyst, I want documented custom elements included alongside standard elements, so that agency-specific documentation can be analyzed through the same interface.
24. As an analyst, I want unique values and their record counts shown without duplicate occurrences inflating the counts, so that I can understand the available data.
25. As an analyst, I want to select several values in one filter and add filters on other elements, so that I can describe the population I need.
26. As an analyst, I want visible filter chips that I can edit or remove, so that the current selection remains easy to understand.
27. As an analyst, I want one explicit Update visualization action, so that several control changes can be applied together.
28. As an analyst, I want unapplied changes distinguished from the last successful result, so that I cannot mistake old results for a new query.
29. As an analyst, I want an unsuccessful refresh to preserve my previous result and my controls, so that a temporary error does not erase my work.
30. As an analyst, I want all groups represented within one visualization, so that grouping does not create a stack of separate charts.
31. As an analyst, I want missing values, recorded absence, invalid values, and zero counts distinguished, so that the visualization does not misrepresent incomplete data.
32. As an analyst, I want empty time buckets retained, so that gaps in documentation are not hidden by a compressed timeline.
33. As an analyst, I want the numerator and denominator of percentages to be understandable, so that I can interpret shares correctly.
34. As an analyst, I want repeated observations and repeated categories handled consistently, so that joins and multiple occurrences do not inflate results.
35. As an analyst, I want a clear empty-result message and explicit size-limit errors, so that an empty or incomplete result cannot look like a complete analysis.
36. As an analyst, I want aggregate CSV to contain the displayed groups, time buckets, calculations, and context, so that I can reproduce the result outside the app.
37. As an analyst, I want record-level CSV to contain one row per matching eligible report and the permitted analytical contributions, so that I can inspect the records underlying the result.
38. As an analyst, I want both exports bound to the displayed query and source revision, so that downloaded data agrees with what I reviewed.
39. As an authorized user, I want catalogs, results, and exports to respect my agency, report permissions, and real or synthetic dataset, so that analytics cannot reveal records outside my access.
40. As a user, I want my agency's colors, language, timezone, and formatting used throughout the interface, so that the panel follows the application's conventions.
41. As a keyboard or assistive-technology user, I want usable selectors, labels, dialogs, chart descriptions, and table alternatives, so that I can complete the analysis workflow.
42. As a mobile user, I want readable controls, an accessible central result, and reachable update and export actions, so that reduced width does not prevent analysis.

# Implementation Decisions

## Application integration and navigation

- Keep Analytics inside the existing top-level Review presentation mode. Do not add a new global application mode or reproduce the mockup's outer session bar.
- Replace the existing Review heading/banner with the two-option Review / Analytics selector. Use the current application layout and shared selected-control treatment. Avoid introducing an additional page heading or banner that repeats the selector.
- Review is the initial submode on first entry, preserving the current entry behavior. Remember submode and analysis state during the mounted Review session; persistence across logout or browser restart is not required.
- Mount the production Review workspace under Review and the new analytics panel under Analytics. The mockup's fictional Review table must not replace any production queue content.
- Preserve queue filters, pagination, selected report, inspector state, scroll position, and in-progress review edits across submode changes. Existing unsaved-change protection continues to apply where an action would discard edits.
- Preserve the analytics draft separately from its last applied query and result. Switching submodes must not silently apply a draft or discard it.
- Keep existing dedicated report/call-window behavior and its close action; that context is not converted into a general analytics workspace.
- Use one Analytics workspace with a shared definition and one central result area.

## Module boundaries

The implementation uses six substantial modules with narrow contracts. Components can be composed within them; this is not a requirement to create a separate abstraction for every field or button.

| Module | Responsibility | Boundary |
| --- | --- | --- |
| Review workspace integration | Banner replacement, submode navigation, permissions, and preservation of Review and Analytics state | Existing authenticated session and workspace context enter; the selected workspace is rendered |
| Analytics query controls | Metric/aggregation compatibility, custom dates, grouping, filter editing, draft validation, and apply lifecycle | Catalog metadata and draft definition enter; a validated query definition is submitted |
| Agency record catalog | Discover observed elements and unique typed values across authorized agency history | Authenticated scope, search, and pagination enter; field metadata, observed values, counts, and coverage return |
| Analytics query service | Validate definitions, resolve eligible records, aggregate values, and retain contribution/freshness metadata | One normalized query enters; one canonical result and source revision return |
| Central result renderer | Line, Bar, Table, legends, completeness, time grouping, and empty/error presentation | Canonical result plus visualization choice enter; one accessible result area is rendered |
| Export service and client | Aggregate and record-level CSV, authorization rechecks, revision coherence, and download states | Applied query, result revision, and export kind enter; complete CSV or an explicit refresh/denial/error returns |

## Query and catalog contracts

Extend or adapt existing Review analytics contracts rather than building a browser-side analytical database. Production aggregation and discovery belong behind the authenticated API.

The canonical query definition distinguishes:

- Metric identity and its declared datatype.
- Aggregation method, separate from metric identity and visualization.
- Visualization, restricted to Line, Bar, or Table.
- Inclusive local From and Through dates, interpreted using the agency timezone.
- Zero or one categorical grouping element.
- Line-chart time grouping: Day, Week, or Month.
- A collection of element filters, each containing one or more typed recorded values.
- Required metric qualifiers, including a compatible unit and per-report repeated-value reducer when applicable.

Organization, permission scope, and the account's real/synthetic dataset must be resolved and enforced by the server. A client-supplied definition must not be able to broaden them. Preserve the application's existing dataset behavior rather than adding a dataset selector from the prototype.

The result contract must contain the effective definition, measure and unit labels, counting unit and population eligibility, categorical values, ordered time buckets when applicable, series/cells, raw counts, percentage numerators and denominators, completeness counts, freshness, and export revision. Contributor metadata remains available to the export service; the browser does not need an unrestricted copy of every underlying clinical record.

Catalog operations must support searching and paging both elements and values. An element descriptor includes stable identity, display label, datatype/meaning, units, supported aggregations, grouping/filter suitability, and repeated-value metadata. Distinct observed values retain typed identity and labels; catalog record counts count a report once per distinct value.

Element identities, custom-definition identities, and coded value identities must not be merged merely because their display labels are identical. Numeric-looking categorical codes remain discrete. Current and historical custom definitions must retain enough identity to avoid conflating different meanings.

## Catalog scope: all agency records

- Discover documented elements and unique values across the agency's authorized record history, independently of the current query's dates, grouping, metric, and filters. A value that exists only outside the selected period remains selectable and can legitimately produce an empty result.
- Include observed standard and custom elements; do not populate options with every possible schema/code-list entry when the agency has never documented them. Empty fields do not become observed catalog entries merely because an authoring definition exists.
- Interpret “all agency records” within existing authorization and retention boundaries. Organization-wide reviewers receive organization-wide discovery. Self-review users receive discovery only from records they can access, with scope labeled accordingly. Catalog counts and search results must not leak other users' or other agencies' records.
- Keep real and synthetic records separate. Retired definitions with retained documented values remain discoverable when permitted. Expired/deleted records and values removed from the effective record must not survive through an unbounded stale cache.
- Use effective report values and established amendment semantics; do not count every amendment as another record or multiply source and normalized copies.
- **Catalog coverage and query eligibility are separate.** Discovery must account for all readable record states, not silently redefine the user's requirement as “records matching the current signed-report analysis.” A value found only in a readable draft may have no eligible signed contributors for a clinical metric.
- Preserve existing restrictions on identifying fields, opaque/free-text values, and analytical suitability. The request does not authorize a general clinical-record browser or an expansion of access rights. Explain an unsupported element where necessary rather than applying an invalid calculation.
- Existing discovery and signed projections do not alone prove the required all-record coverage. Implementation must verify readable-draft and custom-element coverage and add a scoped discovery source where necessary. It must not obtain that coverage by granting analytical callers unrestricted access to private tables.

## Metric and aggregation behavior

Metric and Aggregation are separate controls. Aggregation appears immediately below Metric.

| Metric meaning | Available aggregation | Result meaning |
| --- | --- | --- |
| Continuous numeric value or elapsed duration | Mean, Median, Minimum, Maximum | Summary of valid, unit-compatible per-report values |
| Discrete/categorical value, including coded or boolean values | Count, Percentage | Distinct contributing records per documented category, or their share of the applicable denominator |
| Records | Count, Percentage | Number of matching eligible reports, or each group's share of the matching population |

- Preserve a selected aggregation when it is compatible with a newly selected metric. If it becomes incompatible, select an explicit appropriate default—Median for continuous values, Count for discrete values—and announce the change. The draft remains unapplied until Update visualization is used.
- Validate datatype compatibility on the server as well as in the control. Reject fabricated combinations such as Mean for a categorical code.
- Reuse the supported clinical numeric, categorical, custom, repeated-field, and operational-time capabilities already present. The prototype's example metric list is not the production catalog limit.
- Numeric units must be compatible. Preserve existing medication-unit requirements and never combine unlike units merely because both values are numeric.
- Repeated numeric metrics retain the existing per-report reducer requirement. Choosing an observation within a report is distinct from choosing the aggregation across reports. Show the reducer conditionally and preserve existing order/correlation semantics.
- Overall numeric summaries are calculated from the eligible source values, not from an unweighted average of group summaries or bucket medians.
- Clinical metrics retain their existing signed-report eligibility and effective-amendment rules. Catalog inclusion of a readable draft does not make that draft eligible for clinical means, counts, or exports. Surface the actual counting unit and eligibility in result context; do not blindly copy the prototype's generic “Agency records” label.
- Review-item workload is a different population. Existing workload services must not be relabeled as patient-report metrics or mixed into the clinical denominator. A new workload UI is outside this approved panel's delivery scope; retain existing backend data and compatibility.

## Counts, percentages, and missing values

The following denominator rules make the reviewed Count/Percentage choices precise; they are implementation decisions rather than additional controls.

- For a discrete metric, Count is the number of distinct eligible reports documenting the category within the selected group and, for Line, time bucket. Duplicate occurrences of the same value within a report count once.
- For a discrete metric, Percentage is that category count divided by the number of eligible reports with a valid documented value for that metric in the same group and time bucket, multiplied by 100. Bar and Table use the whole selected period in place of a time bucket.
- For the Records metric, Percentage is a group's distinct-report count divided by all matching eligible reports in the same time bucket, or across the selected period for Bar/Table. No grouping produces the full population's share.
- Example: if 80 of 100 matching reports have a valid discrete value and 20 document a category, that category is 25% of the 80 valid reports. Show the 20 missing/absent/invalid reports separately; do not imply that the denominator was 100.
- Missing, recorded-absent, invalid, and valid states retain their current distinctions. Numeric summaries and categorical valid-value percentage denominators exclude unavailable values. A zero denominator produces an unavailable percentage, not 0% or infinity.
- Repeatable categories and repeatable grouping values can place one report in several categories/groups. Deduplicate within each contribution and disclose that shares can sum above 100%. Preserve parent/occurrence correlations when a field relationship requires them; avoid accidental Cartesian products.
- Group values that are missing can use an explicitly labeled Not documented group. Do not pretend it is a uniquely observed clinical value in the agency catalog.
- A count bucket with no contributors is zero. A numeric-summary bucket with no valid values is a gap; a percentage with no denominator is unavailable. Do not connect a line through unavailable values as though observations existed.
- If an overall percentage appears in the result header, name what it measures, such as documented-value coverage. Do not sum category percentages or present an unexplained 100% as a separate insight.

## Dates, grouping, and the single visualization

- From and Through are always-visible date inputs. Do not introduce preset periods, a preset/custom toggle, or a second date range elsewhere in the workspace.
- Dates are inclusive in the agency's local calendar. Resolve them to a start-inclusive, next-day-end-exclusive interval using the agency timezone so daylight-saving transitions are handled correctly.
- Line uses temporal buckets on its x-axis. The time grouping control is placed under the chart and offers Day, Week, and Month. Weeks start Monday; months are calendar months. Clip partial edge buckets to the chosen period and label them accurately.
- Group by in the rail chooses a documented element and remains independent of time grouping. With a continuous metric, its values become series. With a discrete metric, categories and any selected grouping are represented together within the same visualization, with unambiguous series labels.
- Bar compares the whole-period categorical aggregates. Table replaces the chart with exact whole-period categorical results. Time grouping is inactive and hidden for these views, matching the approved mockup; preserve its prior selection for a return to Line.
- No grouping remains valid for all three visualization choices. Do not add an Automatic option, a Single value visualization, pie charts, heatmaps, or a separate result table beneath a chart.
- Distinct series use labels and line styles as well as color. Long labels and large result sets use bounded scrolling or an explicit size-limit state; never silently omit categories or apply an undocumented top-N cut.
- Titles, legends, axis labels, units, population, dates, filters, and completeness information derive from the applied result. Keep summary information compact and directly associated with that result.

## Applying controls, errors, and state

- Update visualization submits a complete validated draft. Changing metric, aggregation, dates, grouping, filters, or time grouping marks the draft as changed.
- While a new query is pending or fails, retain the last successful result and identify its applied definition. Show loading/failure status and a retry path without clearing useful data or controls.
- Prevent older, slower responses from overwriting a newer applied query. Only a successful response replaces the applied result.
- Disable export while choices are unapplied, while the result cannot be exported, or while authorization/freshness requirements are unsatisfied. Do not export a mixture of draft controls and previously displayed data.
- Clear protected results/catalogs when the user, agency, dataset, or permission scope changes. State preservation is not permission to retain another scope's data.
- Distinguish no observed catalog entries, no search matches, no matching analysis records, and unavailable results caused by errors or stale data.
- Preserve the application's online requirement and analytical freshness reporting. The mockup's synthetic data and immediate calculations must not disguise production projection delays.

## Exports and existing data architecture

- Use one Export menu in the result area, containing Aggregate data and Record-level data, both as CSV.
- Aggregate CSV includes every completed result cell: group/category identities and labels, time bucket where applicable, aggregation, value, unit, count, percentage numerator/denominator, completeness, and query/population context.
- Record-level CSV has one row per matching eligible patient report, including matching reports with missing analytical values where represented in result completeness. Repeated contributions remain structured cells rather than duplicate report rows. Include only permitted analytical fields and the context necessary to relate contributions to the displayed result.
- Reuse request-time authorization checks, no-store handling, source revision checks, and CSV escaping/formula protections. A source revision change refreshes the result for review before another download attempt; revoked access clears the protected result.
- Preserve current explicit export/query bounds and fail rather than returning a partial file. Existing 20,000-report/item and occurrence bounds are prior behavior, not a new license to truncate a catalog or result.
- Extend existing effective analytical projections and typed occurrence/custom-element machinery where the unified query needs it. Do not introduce a second browser-owned source of truth or copy prototype calculations into production as the data layer.
- No physical database table or index layout is prescribed by this PRD. Any required projection, discovery, or migration work must follow the repository's database workflow, preserve scope and amendment semantics, and use measured query behavior to choose storage/index changes.
- Preserve stored analyses and existing backend contracts during migration. Add adapters or versioning where the separate aggregation field and multi-filter definition require it. Keep existing definitions available through their authorized backend contracts.

## UI integration details

Use the existing shared controls, agency CSS properties, typography, focus behavior, dialogs, and available-height layout patterns. Keep the rail and visualization within the desktop workspace, with bounded internal scrolling and reachable Update/Export actions. On mobile and enlarged-text layouts, allow vertical scrolling and full-width controls rather than clipping or shrinking text.

Use native or equivalent accessible tab semantics for Review / Analytics and expose selection and expansion states for visualization and picker controls. Preserve focus when dialogs close and when returning to a workspace. Localize the new labels through the existing system and use configured regional date/number formatting.

Prototype-only values—including demonstration agency identity, sample priorities, fixture dates, catalog size, series names, the ten-year mockup guard, and fictional record counts—are not production requirements. In particular, “Priority” must resolve to the actual selected element's identity and meaning rather than assuming that review-item priority and dispatch acuity are interchangeable.

# Testing Decisions

Test all six module boundaries. Tests should verify externally observable behavior and analytical meaning, not mirror component internals or assert a particular decomposition of helper functions.

| Module | Required evidence |
| --- | --- |
| Review workspace integration | Banner replacement within the real app shell; Review remains the existing queue; navigation preserves queue and analytics state; permissions and dedicated report views remain correct |
| Analytics query controls | Aggregation is directly below Metric; compatible choices and defaults follow datatype; custom dates are always visible; grouping and time grouping are independent; multi-value/multi-element filters and unapplied-change states work |
| Agency record catalog | Agency/user/dataset isolation; observed-only discovery across all permitted history and readable states; a value outside the selected dates stays selectable; custom identity, repeated-value deduplication, search/pagination, amendments, deletion, and synthetic cleanup are correct |
| Analytics query service | Numerical summaries, counts, percentages and denominators; empty buckets; missing/absent/invalid distinctions; units, repeated-value reducers and parent correlations; date/timezone/DST boundaries; query validation and explicit bounds |
| Central result renderer | Exactly one central Line/Bar/Table result; time control beneath Line and hidden elsewhere; legends/units/labels; no false zero or connected missing interval; accessible table and chart descriptions; mobile, zoom, nondefault agency palette, and keyboard behavior |
| Export service and client | CSV agrees with the applied query and source snapshot; all aggregate rows are present; one record row per report; percentage metadata and missing values survive; stale-source refresh, access revocation, formula escaping, and explicit size-limit failures |

Use API/database integration tests for authorization, distinct-value discovery, typed aggregation, temporal boundaries, and export coherence. Use focused unit tests for pure compatibility and mathematical rules where they add value. Use browser tests for navigation, draft/result state, dialogs, and the user-visible workflow. Perform browser inspection for layout and appearance; source inspection alone is insufficient.

Required acceptance journeys:

1. Start in the current Review workspace, set queue filters and select a report, switch to Analytics through the replaced banner, run an analysis, and return to the same Review state.
2. Select a continuous metric and verify Mean/Median/Minimum/Maximum. Change to a discrete metric and verify Count/Percentage, the announced fallback, and server rejection of invalid combinations.
3. Analyze a custom date range by one documented category and Week. Change to Day and Month beneath the same line chart, then to Bar and Table. Confirm that controls remain unified and that the temporal versus whole-period semantics match the definition.
4. Choose an observed field/value documented only outside the selected period. Verify that it remains available, produces an honest empty result, and does not change the catalog counts when dates or other filters change.
5. Exercise multiple filter values, multiple fields, custom elements, repeated values, missing data, and a zero denominator. Verify exact raw counts, denominators, and summaries against known source records.
6. Edit controls after running an analysis, switch between Review and Analytics, simulate a failed refresh and out-of-order responses, and confirm that retained results are clearly labeled and stale exports cannot be initiated.
7. Export aggregate and record-level CSV for the displayed result. Change the source or revoke access before a second export and verify the existing refresh/denial behavior.
8. Repeat critical navigation and export journeys for own-report access and synthetic accounts. Verify that catalogs cannot reveal values or counts outside the authorized scope.

Relevant prior art includes the existing Review analysis tests for typed summaries and field restrictions; repeated/custom-grouped tests for occurrence correlation; database access and synthetic-cleanup tests; CSV tests for source revisions, deduplication, and hostile cell values; Review entry/call-window tests for state and focus; and local-time Review tests for date boundaries. Browser analytics journeys cover the unified panel and its integration with Review.

# Out of Scope

- Copying the mockup's outer application shell, session header, demonstration identity, preview annotations, footer, sample dataset, or fictional Review queue into production.
- Redesigning the existing Review queue, report inspector, clinical report viewer, review settings, administration, or global application navigation beyond the requested banner replacement.
- Multiple analytics dashboards or concurrent visualization panels.
- Visualization types beyond Line, Bar, and Table; preset-date selectors; and a separate Single value or Automatic visualization choice.
- New review rules, routing, assignments, review-item workflow behavior, or changes to who may read records.
- A new workload-analysis UI, saved-view management UI, scheduled reports, sharing, statistical inference, predictive analytics, arbitrary SQL, or a general-purpose BI designer.
- Unrestricted clinical-record exports, free-text exploration, new identifying-data permissions, or changing the existing signed eligibility of clinical statistics.
- Implementing the production feature, applying migrations, or publishing implementation tickets as part of writing this PRD.

# Further Notes

- Recorded on 2026-10-04 from the approved control-rail mockup, the subsequent aggregation control, and the explicit instruction to integrate only the analytics panel beneath the mocked selector while replacing the production Review banner.
- The [Review workflow PRD](review.md) defines workflow, permissions, analytical privacy, amendment lineage, freshness, and export safeguards. Existing stored analyses and workload backend data remain available through their authorized contracts.
- Denominator rules, catalog-versus-query eligibility, initial Review selection, and migration compatibility are explicit implementation decisions needed to make the reviewed interface precise. They must not be mistaken for broader product requests.
- The main data dependency is observed-value catalog coverage across all readable record states. Existing signed-only analytical sources must not be assumed to satisfy this without evidence. The main calculation risks are repeat fan-out, mismatched percentage denominators, and timezone boundaries. The main integration risk is accidentally replacing or remounting the existing Review workspace while copying the mockup shell.
- The prototype supports design review, not proof of production authorization, scalability, projection freshness, or mathematical completeness. Its browser checks do not replace the implementation tests above.
- References: [approved mockup](../design/analytics-mockups/index.html), [desktop preview](../design/analytics-mockups/analytics.png), [element picker](../design/analytics-mockups/catalog.png), [value picker](../design/analytics-mockups/values.png), [UI style guide](../design/ui-style-guide.md), [Review workflow PRD](review.md), [Analytics API and CSV contracts](../runbooks/unified-analytics.md), and [analytical privacy boundary](../analytical-privacy-boundary.md).

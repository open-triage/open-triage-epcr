# Unified analytics workspace

Review opens the existing queue. Its Analytics selector opens one Line, Bar, or
Table workspace. Switching between them preserves the queue, open report,
inspector, analytics controls, and last successful result. Changed controls take
effect only after **Update visualization**. Exports use the applied result.

## API and scope

The cookie/bearer-authenticated endpoints are under `/api/review/analytics`:

- `GET /elements?purpose=metric|group|filter&search=…&page=1`
- `GET /values?element=…&search=…&page=1`
- `POST /query` with the version 1 `AnalyticsDefinition` contract
- `POST /export` with `definition`, `expectedRevision`, and `kind` (`aggregate`
  or `records`)

Every request resolves the current Review permissions. Organization, own/all
report scope, and real/synthetic dataset come from the session. Clients cannot
choose a broader dataset or scope. POST requests retain the application's CSRF
guard, and responses use `Cache-Control: no-store, private`.

Discovery reads authorized, nonexpired effective records, including readable
drafts and added/replaced/removed amendments. It does not use analysis dates.
Catalog pages contain 50 entries; counts deduplicate reports. Supported standard
fields retain the existing Review analytical allowlist. Custom identities include
the pinned definition's semantic fingerprint, so equal labels or changed meanings
do not merge. Unsupported custom datatypes remain explained in the metric picker.
No analytical role receives new grants and no schema migration is required.

**User** is available for grouping and filtering by the record's documenting
user. Choices come from the same readable history, including inactive users
with retained records. Immutable user IDs keep people distinct even when their
display names match or change. Names follow the existing `review:identifying`
permission; otherwise choices and groups show user IDs. The metric selector
continues to offer Records and the enabled metric/rule library.

Query and export use the existing signed analytical projections in a
repeatable-read snapshot. They preserve the reporting replica configuration and
five-minute freshness requirement. A historical draft-only value can therefore
be selectable while producing no eligible analysis records.

## Calculations and bounds

Numeric metrics offer Mean, Median, Minimum, and Maximum. Repeated numeric metrics
require a separate First, Last, Minimum, or Maximum per-report reducer. Clinical
time orders First/Last when all candidates have it; otherwise pinned occurrence
order applies. Incompatible units are never combined. Repeated relationships
preserve clinical ancestry.

Categorical counts deduplicate reports per category. Their percentages divide
by reports with a valid metric value in the same group and bucket. Records
percentages divide by all matching reports in that bucket. Overlapping
categories/groups can exceed 100% in total. Missing, recorded-absent, and invalid
values remain distinct; a zero denominator is unavailable. Numeric lines leave
gaps where no valid values exist.

Line uses calendar Day, Monday-starting Week, or Month buckets, clipped to the
selected inclusive reporting dates. Bar and Table summarize the entire period.
Results include agency timezone and the corresponding half-open instant bounds,
including daylight-saving changes.

Requests fail explicitly above 366 inclusive days, 20,000 source reports, 20,000
selected repeated/custom occurrences, 100 series, or 20,000 result cells. A query
allows at most 20 distinct filter elements and 100 selected values per filter.
Catalog pagination is independent of those result bounds.

Recorded dropdown discovery is cached in API process memory for up to 30 seconds.
The bounded cache separates organizations, users, permissions and datasets, shares
concurrent loads, and reuses the element catalogue across grouping, filtering,
searches and pages. Value pages are cached by element, search and page. Every
request still checks the current session and permissions; failures are not cached.
New, amended or removed choices can take up to 30 seconds to refresh. Configured
metric publications, included counts, queries and exports always read current
data. Browser search waits for 200 ms of idle typing before requesting choices;
discovery data is not persisted in browser storage.

## Exports and verification

Aggregate CSV includes every result cell and its identity, count, denominator,
completeness, units, and query context. Record CSV contains one row per matching
report, including missing analytical values, with structured per-group
contributions. Both use the existing CSV escaping and formula protection.

A changed source returns `409` with a refreshed result for review before another
download. Authorization denial clears protected results and choices. Source
revision checks include selected report revisions and permitted contributions;
the passage of observation time alone does not invalidate a result. Existing
saved-analysis and workload backend contracts remain available.

Focused checks:

```sh
npm run build -w @open-triage/api
node apps/api/tests/unified-analytics.test.mjs

# Existing local database and synthetic fixtures; all fixture writes roll back.
set -a
source .env.local
set +a
node apps/api/tests/unified-analytics-postgres.integration.test.mjs

OPEN_TRIAGE_E2E_SERVER_MODE=true npx playwright test \
  --config apps/web/playwright.config.ts \
  apps/web/e2e/analytics-workspace.spec.ts apps/web/e2e/analytics-csv.spec.ts \
  apps/web/e2e/review-tabs.spec.ts apps/web/e2e/review-call-window.spec.ts \
  --project=android-390x844 --workers=2
```

The database test covers live draft/custom discovery, scope isolation, repeated
deduplication, amendments, typed signed queries, daylight-saving bounds, source
revision conflicts, stale projections, and denied private-table access. Browser
journeys cover Review preservation, all visualization controls, filters, failed
and delayed queries, export refresh/denial, accessibility, mobile, enlarged text,
and agency colors.

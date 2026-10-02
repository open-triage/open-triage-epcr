# Analytics projection operations

The production scheduler is defined only by the
[`analytics-cronjobs.yaml` Helm template](../../deploy/helm/open-triage/templates/analytics-cronjobs.yaml).
Configure it through the chart's `analytics` values. Both jobs use the immutable
`api.image` selected for the application, the configured `imagePullSecrets`, and
the distinct database Secrets selected by
`secrets.analyticsProjector.existingSecret` and
`secrets.analyticsHealth.existingSecret`; each Secret exposes only its
workload-specific `DATABASE_URL`.

The default projector schedule runs one bounded batch every two minutes with
overlapping runs forbidden. This cadence leaves normal operating margin inside
the five-minute signed-to-analytical freshness target. Scale `analytics.batchSize`
from observed arrival volume; never replace it with an unbounded drain loop.
`analytics.maxAttempts`, `analytics.freshnessTargetSeconds`,
`analytics.resources`, and `analytics.healthResources` control the remaining
operational limits.

When an operator or deployment system needs raw Kubernetes YAML, render only the
canonical analytics template with the installation's private values:

```sh
helm template open-triage ./deploy/helm/open-triage \
  --namespace open-triage \
  --values /private/path/installation.values.yaml \
  --show-only templates/analytics-cronjobs.yaml \
  > /tmp/open-triage-analytics-cronjobs.yaml
kubectl apply --namespace open-triage \
  --filename /tmp/open-triage-analytics-cronjobs.yaml
```

Do not edit or commit the rendered file. Update the chart or installation values
and render it again so Helm installs and raw-manifest consumers stay identical.

The companion health job runs each minute. It emits one structured JSON record and
exits non-zero when the oldest backlog exceeds 300 seconds or a terminal failure
exists, a queue run fails, or a run remains incomplete for five minutes. Forward
that record and Kubernetes job failures to the installation's
monitoring system. Page on either condition, and warn when no successful queue run
has completed for five minutes. The record contains counts, ages, timestamps,
statuses, and reconciliation outcomes only. The projector deliberately records
stable error codes rather than exception text; neither job logs clinical values,
aggregate/report identifiers, event payloads, SQL text, or bind parameters.

Operators with `open_triage_operational` may inspect the same safe contract:

```sql
select * from operations.projection_health;
select * from operations.projection_failures order by failed_at;
```

The failures view exposes an operational event ID but excludes the report ID and
payload. Transient failures use capped exponential backoff. After
`ANALYTICS_PROJECTOR_MAX_ATTEMPTS` (12 by default), an event is quarantined, stays
visible in `operations.projection_failures`, and is no longer selected by routine
runs. Capture its event ID and error code, resolve the underlying deployment or
data-contract fault, and have a database administrator clear `failed_at`, reset
`attempt_count` to zero, and set `available_at = now()` for that exact event. Do
not edit its aggregate ID or payload. Confirm recovery through the health view.

## Replay and reconciliation

Replay rebuilds one known signed report from authoritative signed state and its
ordered amendments. It is safe to repeat:

```sh
npm run project -w @open-triage/database -- --replay REPORT_UUID
```

Reconciliation compares effective lineage and row counts, repairing only stale
or missing projections. Run it after incident recovery and inspect
`last_reconciliation_*` in `operations.projection_health`:

```sh
npm run project -w @open-triage/database -- --reconcile --report REPORT_UUID
npm run project -w @open-triage/database -- --reconcile --from 2026-01-01 --to 2026-01-31
```

Dates are inclusive. Begin with the smallest affected selector. A failed run is
recorded with a safe error code and a non-zero exit; correct the cause and repeat.

## Backfill

### Custom scalar transition (projector 1.2.0)

After deploying migration `20261002190000_review_custom_scalar_analytics.sql` and
the 1.2.0 projector, rebuild each historical signed-report date range with the
bounded backfill command below. Use a unique key per range, run it repeatedly
until `processedCount` is zero, then reconcile the same range. The projector
reconstructs effective add, replace, and remove amendments from clinical history,
deletes the old projection in the same transaction, and writes each surviving
custom value exactly once into `epcr_repeatable_element`. Report-level custom
rows have null analytical group fields; their clinical root group is unchanged.

Older `additional_elements` and `additional_identifying_elements` JSON may still
exist on reports awaiting rebuild. Review custom BI reads only the long table,
so it never unions or counts those JSON copies. Reports awaiting rebuild can
appear missing for a custom field; the projector version makes reconciliation
detect them as stale. After backfill, the projector omits custom values from
the JSON additions. Compare counts by report and custom identity through the
projector role before retiring the transition. Run the backfill separately for
real and synthetic report dates as needed; the projector preserves each report's
dataset classification.

### Grouped custom transition (projector 1.3.0)

Migration `20261002220000_review_custom_grouped_source.sql` includes grouped and
repeated custom rows in the same API-only source as standalone rows. Run the
bounded historical backfill above for every signed-report date range after the
1.3.0 projector is deployed, then reconcile each range. This also rebuilds
earlier grouped rows whose `is_custom` flag was introduced by 1.2.0. Replay
deletes a report's prior long rows before inserting its effective occurrences
in one transaction; custom analyses read that table once and never union with
wide JSON additions. The projector version change makes older projections
visible to reconciliation as stale.

Use a unique, non-clinical job key and an inclusive date range. Each invocation is
bounded by `ANALYTICS_PROJECTOR_BATCH_SIZE`; invoke it repeatedly until its run
reports no additional work:

```sh
npm run project -w @open-triage/database -- --backfill 2026-q1-rebuild --from 2026-01-01 --to 2026-03-31
```

The selector is immutable for a job key. Its cursor advances transactionally with
each rebuilt report, so interruption and replay resume safely. Watch
`integration.projection_backfill_job` using a privileged maintenance connection,
and run reconciliation over the same range when the backfill completes. Backfills
must use a separately scheduled job with controlled concurrency; do not enlarge
the routine queue batch until it threatens the normal freshness margin.
# Repeated Review fields

The basic Review builder exposes an allowlist of non-identifying repeated standard fields from
`analytics.review_repeated_field_source`. Category membership is deduplicated within each
patient report; a report may contribute to several categories, so category percentages can
exceed 100% in total. A repeated numeric field requires a first, last, minimum, or maximum
reducer before the cross-report mean, median, minimum, or maximum is calculated. Medication
dosage also requires an explicit unit code; doses in other units are excluded from that result.

First and last use clinical timestamps only when every eligible occurrence in that report has
one. If any timestamp is missing, they use group ordinal, element ordinal, then occurrence ID
for the whole report. Equal timestamps use the same deterministic ties. Occurrence order
expresses documentation order and must not be described as clinical chronology. Results retain
the effective source values and occurrence/group IDs for later record export. The API rejects
analyses above 20,000 source rows; narrow the period or filters before retrying.

# Review workload API compatibility

The retained `/api/review/workload` and `/api/review/analysis` contracts cover
operational workload and Review filters. For the current Analytics workspace,
see [Unified analytics](unified-analytics.md).

Review workload reads the operational Review tables on the primary database. Its
unit is one durable `clinical.review_item`, including overdue unsigned items.
The selected date range uses `first_matched_at` (the initial discovery time),
regardless of retrospective discovery or later amendments. An item reopened by
a signed amendment remains one item and contributes to the reopened count.
Current status and priority are used for grouping. Age is measured from initial
discovery to the operational read time for an open item, or to its latest
completion for a completed item. Completion duration uses the latest completed
history event minus the latest relevant-amendment reopening before that event;
without a reopening it uses initial discovery. Items without a completion event
are grouped as not completed. Exceptional closures use their fixed reason codes;
`unsignedItems` counts overdue items whose report is still a draft. The
operational freshness timestamp is the primary read time, independent of signed
projection freshness. Workload CSV includes the item unit, scope, dataset,
period, freshness source, and aggregate revision.

Clinical analysis remains signed-only and counts patient reports. Its optional
Review criterion filter requires an active matching criterion item on the same
report. Its recorded outcome filter checks append-only progress history, so a
retired or replaced outcome remains discoverable. When both filters are set,
they must match the same item. The API first selects distinct report IDs within
the caller's organization, dataset, report scope, and reporting-date range;
all analytical source paths then apply that bounded report set. This prevents
multiple Review items on one report from multiplying clinical counts. Unsigned
overdue items cannot match clinical filters. Analysis CSV records the exact
criterion and outcome filters along with signed patient-report context.

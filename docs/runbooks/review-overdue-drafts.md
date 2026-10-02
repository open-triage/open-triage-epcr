# Overdue unsigned Review work

The existing Review CronJob runs `processReviewWork` on a bounded batch. Each run
first scans up to `REVIEW_BATCH_SIZE` server-known unsigned reports, then discovers
ordinary signed work. The scan uses the current, non-tombstoned `eTimes.16` EMS
call-completed timestamp; if it is absent, it uses `clinical.report.created_at`.
It never uses `updated_at`, so ordinary draft edits do not restart the deadline.
The default deadline is 24 hours. A Review administrator can change it to 1–720
hours in Review; changes affect drafts not yet detected. Each detected item pins
its basis, source, and deadline for history and repeatable reads.

The stable overdue criterion ID is derived per organization by
`clinical.review_overdue_criterion_id(organization_id)`. It appears in Review routing alongside published ordinary criteria. Administrators
can route future overdue items to the documenting clinician, an eligible named
reviewer, or the unassigned queue. The usual claim and assignment controls apply.
The report row is locked before creating the item and the unique
`(organization_id, report_id, criterion_id)` key prevents duplicates on retries.

An unsigned report can be opened read-only in Review only through its overdue
item. The API checks organization, real/synthetic dataset, self/all report scope,
and identifying access on each read. Drafts do not enter signed report lists,
ordinary criterion evaluation, or clinical analytics. The signing transaction
changes the report status, records `resolved-by-signing` on the overdue item,
and appends durable history; the ordinary signed Review worker then evaluates
the signed snapshot. A cancellation event alone leaves the draft overdue until
the ordinary cancelled-disposition and signature path completes.

To replay overdue discovery, run the Review worker again. It is safe to retry;
existing items and their pinned deadline are retained. Operational investigation
can compare `clinical.review_item` rows with `kind='overdue-unsigned'` and
`clinical.review_overdue_history` to the signed-only `clinical.review_work` queue.

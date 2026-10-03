# Initial Validation rollout and unsigned clinical reset

The forward migration preserves every signed report, signature, validation finding, and warning acknowledgement. Records signed before Validation versioning retain null `validation_version_id` values and receive `legacy_unversioned_validation = true`; the rollout never assigns them a policy they did not use.

`npm run migrate -w @open-triage/database` applies schema changes only. Opening an
Admin editor also performs no imports. To import a definition, use **Import from
defines** in Catalog, Forms, or Validation, select a JSON file, and click **Import
selected file**. The definition must match a published catalog available to the
agency. Import publishes an agency version; activation remains a separate action.
Publish or discard an existing draft before importing.

Explicit demonstration bootstrap still loads its catalog and form, then seeds
baseline validation and inactive options. The standalone `seed:validation` and
`seed:install-definitions` commands remain explicit operator actions. Baseline
seeding preserves organizations with active bundles; option seeding preserves
existing versions and skips agencies with drafts. Sweden's form shows 215 NEMSIS
elements; ePayment remains in the shared catalog and its 52 Sweden rules are
retained but disabled. The baseline remains active until an administrator
explicitly activates a compatible option.

The migration credential alone performs this rollout. Long-lived API, analytics, and retention workloads do not receive the reset function. Existing Validation capabilities remain: the installation owner and Administrator can publish; Demo can read/write but not publish; custom roles receive nothing automatically.

## Review rule priority compatibility

A review-target validation rule has a High, Medium, or Low review priority independent of its Error, Warning, or Information severity. The priority does not change its assertion or signing behavior. New authoring requests without a review priority use Medium, and publication writes that priority into the compiled bundle. Previously published review rules with no priority remain immutable and readable; readers treat their missing priority as Medium. Publishing a new version does not evaluate historical reports or add them to a review queue.

## Reset unsigned rollout data

Run the preview from a trusted host with the short-lived migration `DATABASE_URL`:

```sh
npm run reset:unsigned-clinical -w @open-triage/database
```

The command prints exact unsigned report and call IDs, counts, and the number of excluded signed reports, then exits without changing data. Review this output. To approve exactly that boundary, rerun:

```sh
npm run reset:unsigned-clinical -w @open-triage/database -- \
  --confirm DELETE-UNSIGNED-CLINICAL-WORK
```

The confirmed run starts a serializable transaction, locks and compares the target set with the preview, and aborts if either the unsigned or signed boundary changed. The database function independently rejects any report or call with a signed snapshot. After commit, the command verifies that no unsigned targets remain and that every signed report ID, snapshot ID, and canonical digest is unchanged.

Treat any boundary-change or verification error as a failed rollout. Do not delete rows manually or substitute an API/retention credential; inspect concurrent clinical activity, take a new preview, and obtain operator confirmation again.

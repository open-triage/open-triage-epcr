# Initial Validation rollout and unsigned clinical reset

The forward migration preserves every signed report, signature, validation finding, and warning acknowledgement. Records signed before Validation versioning retain null `validation_version_id` values and receive `legacy_unversioned_validation = true`; the rollout never assigns them a policy they did not use.

`npm run migrate -w @open-triage/database` publishes and activates the NEMSIS full Validation rules in `defines/validation/validation_nemsis-full.json` for every organization with the matching published form and sealed catalog but no active complete configuration bundle. Rules whose inputs are not available from the active Form/platform remain disabled. Re-running the migration or seed is safe: organizations with an active bundle are reported as `already-active` and are not changed. Fresh demonstration bootstrap runs the seed again after Catalog and Form creation.

After that baseline is active, migration and demonstration bootstrap discover matching non-default files under `defines/forms` and `defines/validation` and publish them as inactive options against the same NEMSIS catalog. Sweden's form shows 215 NEMSIS elements; ePayment remains in the shared catalog and its 52 Sweden validation rules are retained but disabled because those fields are not shown. The default remains active until an administrator explicitly activates a compatible option. Re-running option installation is idempotent; it skips organizations with an authoring draft rather than changing that draft. For an organization initialized after migration, run `npm run seed:install-definitions -w @open-triage/database` after its baseline configuration is active.

The migration credential alone performs this rollout. Long-lived API, analytics, and retention workloads do not receive the reset function. Existing Validation capabilities remain: the installation owner and Administrator can publish; Demo can read/write but not publish; custom roles receive nothing automatically.

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

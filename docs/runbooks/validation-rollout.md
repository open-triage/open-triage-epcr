# Initial Validation rollout and unsigned clinical reset

The forward migration preserves every signed report, signature, validation finding, and warning acknowledgement. Records signed before Validation versioning retain null `validation_version_id` values and receive `legacy_unversioned_validation = true`; the rollout never assigns them a policy they did not use.

`npm run migrate -w @open-triage/database` seeds and activates one initial published Validation version for every organization with a published stationary Form and sealed Catalog but no active complete configuration bundle. The seed combines current Catalog occurrence/agency requirements, Form requiredness and conditional requiredness, and the pinned NEMSIS 3.5.1 EMS import. Rules whose inputs are not available from the active Form/platform remain imported but disabled. Re-running the migration or seed is safe: organizations with an active bundle are reported as `already-active` and are not changed. Fresh demonstration bootstrap runs the seed again after Catalog and Form creation.

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

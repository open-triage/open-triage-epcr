# Production jobs from enrolled units

New production jobs use the browser installation's immutable registration and its
associated live clinician session. The current dispatch assignment must belong to
that active unit and the selected agency, and the user must currently have
`clinical:document`. No production clinician-to-unit roster is required or consulted.
Switching the selected agency never reassigns the installation. Select the enrolled
unit's agency or use the administrator's explicit reassignment workflow and sign in
again. Revocation and reassignment remain scoped to the original registration.

A unit with no selected schedule is incomplete setup. Select a schedule in Admin;
an explicitly blank schedule allows ordinary clinician-session job opening without
any shift reminder or checkpoint. The server evaluates active and pending immutable
schedule versions using the existing prospective/DST evaluator and its own clock.
A nonblank schedule fails closed with a handover-required diagnostic while the
scheduled-shift gate in slice 017 remains pending. A pending switch to blank does
not bypass the outgoing schedule before its effective boundary.

Listing returns `productionAccess` with the enrolled unit and an actionable state.
Opening rechecks that context under registration, agency, unit, session and assignment
locks, then creates a single report using the owning agency's published bundle.
Cancellation, another clinician's open, changed permissions, a retired registration
or an obsolete browser context cannot turn a stale listing into access. Retried
opens keep the original author, assignment, agency and pinned configuration.
Existing authorized reports, including an already-opened assignment retry and an
additional patient on an owned incident, remain available on an unpaired workstation.
Additional-patient reports retain that incident's original report configuration and
real/synthetic classification. Ordinary standalone production creation uses the
same device/schedule gate. Authorized Admin and Review work remain independent of
new-job readiness.

Synthetic roster mappings apply only to synthetic assignments on synthetic incidents
for users with the Demo capability. The immutable demonstration fixture identity and
users explicitly marked synthetic cannot list or open real production jobs even
when paired or rostered to the unit. Demo permission cannot relabel an existing
production incident as disposable synthetic work.

The forward migration repairs only unsigned reports whose persisted assignment and
incident both prove production provenance and whose report has no generated-synthetic
provenance or synthetic expiry deadline. It changes only classification and preserves
all ownership and configuration pins. Signed records retain immutable history, and
ambiguous standalone historical records are not guessed or relabeled; those need a
separate evidence-based operational review. This slice does not enable the complete
regional/shift rollout planned in slice 019 or claim its acceptance checks completed.

`npm run check:ci` includes the runtime TypeORM PostgreSQL production-job races and
English/Swedish mobile/desktop browser journeys. Focused coverage lives in
`apps/api/tests/production-job-postgres.integration.test.mjs` and
`apps/web/e2e/production-jobs.spec.ts`.

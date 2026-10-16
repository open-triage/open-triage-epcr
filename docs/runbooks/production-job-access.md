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
For a nonblank schedule, this device's `personally_authenticated_at` must reach
or exceed the active checkpoint's `graceStartsAt`. A 07:00 checkpoint with
15-minute grace accepts 06:45 authentication and rejects 06:44 authentication.
The ordinary fixed session maximum and all access/device checks still apply.
Local password login, replacement and reauthentication record verified completion
using PostgreSQL's clock in live requests. OIDC uses the validated, signed
`auth_time` lower bound; neither token issuance nor activity proves freshness.
A new login or reauthentication on another session never refreshes this one.

Every new-job attempt inside any incoming grace window shows the server's current
clinician name and enrolled unit. Continue confirms only that attempt; Switch user
uses the shared personal-authentication/storage transition in the effective next
login mode. Local Switch ends the outgoing session before enabling the next login;
SSO Switch starts the protected provider transaction. Cancel retires the
attempt. English/Swedish controls use the shared modal, native keyboard handling,
and mobile-safe layout.

`POST /api/calls/new-job-confirmations` creates a five-minute opaque token for an
assignment or standalone command, with session CSRF protection. The private token
digest is bound to that exact session, target, live unit, effective selection and
schedule/checkpoint context. A newer attempt for the same target retires an old tab's
token. `DELETE` retires a canceled attempt. Creation accepts the token through
`x-job-confirmation`, checks live authority and session expiry, reassesses schedule
context after domain waits, and consumes it atomically in the report transaction.
Successful assignment/command retries reopen existing work; they never create a
second report. Another session, target, effective schedule, expired attempt or
consumed token cannot authorize new work.

Continue never writes personal proof, recent reauthentication, session expiry or
protected ciphertext deadlines. A 06:44 login confirmed at 06:50 still needs fresh
authentication after the 07:00 checkpoint in the 15-minute example. Overlapping
incoming windows use the shared evaluator's complete checkpoint context. A zero-
grace schedule has no reminder window. Outside grace, stale proof returns
`reauthentication-required` and the shared clinical flow offers local or organization
personal authentication. Explicit shift retries request a new proof even when a
proof within five minutes remains recent for an ordinary sensitive/recovery action.
Initial selection is prospective and does not invent a previous checkpoint.
A pending switch to blank does not bypass the outgoing schedule before its boundary.

The server reassesses after authentication and again after call/command authority
waits immediately before creating a report. Session expiry during those waits
also denies creation. Authentication never owns a call-opening transaction, and
same-user reauthentication preserves its original cookie and expiry. On an OIDC
redirect the browser retains only an expiring assignment/user/agency intent in
session storage. On return it checks current identity and a fresh server listing;
the actual opening operation independently checks current authority again.
A withdrawn, canceled, reassigned or unavailable intent grants no access. No
clinical labels, report keys or drafts enter redirect storage.

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

Generated synthetic calls use the same enrolled-unit listing, schedule,
confirmation and opening checks as production calls. Any authorized clinician on
a paired device can receive them; Demo permission is required for generation and
Demo-only editing tools, not normal receipt and documentation. The generating
user selects an active agency unit. Call and report synthetic classification,
generator provenance, source-assignment links and retention remain unchanged,
including additional patients documented by a recipient without Demo permission.
Report ownership belongs to the clinician who opens the call. The dedicated
fictional fixture and explicitly synthetic account identities still cannot take
real production jobs.

A revoked pairing removes new unit-job access without revoking personal sign-in,
existing reports or owner-authorized protected-report recovery. A retired cookie
can create a fresh unpaired personal session. Explicit user-session revocation
and the separate reassignment sign-out transition remain independent.

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
`apps/web/e2e/production-jobs.spec.ts`. Slice 017 also adds deterministic
threshold/DST regressions in `apps/api/tests/current-shift.test.mjs`, real
local completion/expiry tests in `clinician-session.test.mjs`, and local/OIDC
English/Swedish browser transitions in `apps/web/e2e/current-shift.spec.ts` and
`apps/web/e2e/new-job-confirmation.spec.ts`.
`current-shift-oidc-postgres.integration.test.mjs` runs a separate real TLS
provider, application API, deployment proxy and browser against a disposable
PostgreSQL database. Both local password and organization sign-in browser journeys create
real production reports and reopen existing work while shift proof is stale. It
verifies signed proof across a handover during login,
another-device freshness, outage, fixed expiry, actual standalone production
creation and authorized existing-report reopening. It also exercises local and
controlled-OIDC overlapping-grace Continue/Switch, repeated new reports, canceled
reminders, unchanged personal proof/fixed expiry and outgoing session revocation. Its explicit test-only server
clock advances the evaluator while the provider interaction is open; live
production continues to use PostgreSQL time. The fixture waits for actual provider
personal authentication to reach the checkpoint before expecting success.

These controlled tests establish the configured contract's behavior. Regional
AD FS/PAS, physical Android/PWA scanning and Windows personal-session acceptance
remain the separate deployment dependencies described in the agreed PRD.


Agency Settings → Demo records → Default unit for Demo users selects an optional
active unit in that agency. A user with live Demo and clinical documentation
permissions can use that unit without enrolling the browser. This personal
default creates no installation registration and supplies no additional roles.
Existing explicit pairings take precedence, including retired or revoked
registrations; revocation cannot silently activate a default instead. Unit
schedules and per-call confirmation still apply. Clearing the setting, disabling
the unit, or withdrawing Demo permission stops automatic new-call routing;
existing authorized reports remain available. The dedicated fictional demo
account remains unable to receive real production work.

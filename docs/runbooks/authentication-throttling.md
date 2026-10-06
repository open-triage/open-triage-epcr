# Authentication throttling operations

OpenTriage applies two independent controls to every password verification path:

- The API stores atomic Postgres counters keyed by HMAC-SHA-256 digests of the
  normalized username, installation, and coarse network source. The account
  bucket begins progressive delays after three failures (1, 2, 4 seconds,
  capped at five minutes), defaults to at most 20 attempts per 15 minutes, and fully
  recovers after that window. Network buckets default to 60 attempts per five
  minutes per agency and source; the installation bucket allows 300 per minute. A success records
  `last_success_at` but does not clear failures.
- The NGINX authentication Ingress limits `/api/sessions` to 10 requests per
  second per source with a three-times burst by default. The main API Ingress
  remains independent so clinical traffic is not subject to this safety limit.

## Agency configuration

In **Admin → Agency Settings → Login attempt limits**, an administrator with
`settings:write` can set the account and shared-network limits independently to
whole numbers from 1 through 1,000. Both successful and unsuccessful password
checks count, including sign-in, password changes, and reauthentication. The
15-minute account and five-minute network windows are fixed. Defaults remain
20 and 60 for existing and new agencies; unknown usernames use those defaults.

For a 50-person shared-login demo, start with 100 account attempts and 200
network attempts, then rehearse on the intended deployment. These are attempt
budgets, not concurrent-session limits. Venue Wi-Fi generally shares one public
network address. The installation cap (300/minute), ingress burst limit, and
progressive failed-password delays remain active and may still reject a burst.

Changes are revision-guarded and audited with their old/new values. Every
password check resolves the current policy; changing it does not clear attempts
or failure evidence already recorded. Clients omitting `authenticationLimits`
preserve the existing policy. Network bucket digests now include the resolved
agency identity, so one agency's policy does not change another's allowance.
The first upgrade to agency-scoped network buckets starts fresh network counters;
account and installation counters retain their existing keys.

Counter upserts and result updates lock buckets in a consistent order. Keep
that ordering when changing this code: concurrent sign-ins previously could
deadlock while marking successful attempts.

## Bounded demo load exercise

`scripts/load-test-demo.mjs` requires an explicit API URL. Use only fictional
data. Credentials come from `LOAD_TEST_USERNAME` / `LOAD_TEST_PASSWORD`, with
the repository's synthetic fixture as the default. Do not pass credentials as
command-line arguments.

```sh
node scripts/load-test-demo.mjs --base-url http://localhost:3001 \
  --users 50 --seconds 120 --write --output /tmp/demo-load.json
```

This signs in 50 independent sessions simultaneously, generates and opens a
separate call for each participant in sequence, then exercises synchronized
list reads, draft edits and active-report reads. It checks saved revisions,
deletes only its generated drafts, and logs out its sessions. It refuses to
open a reused assignment. An existing unopened demo call must be handled
before a write exercise. A failed call-open can leave a newly generated
assignment to be handled through the ordinary demo workflow.

The JSON artifact contains response status counts, bytes and latency
percentiles, without credentials or clinical response bodies. `--sessions 1`
allows a shared-session workload baseline against an older deployment, but
does **not** validate simultaneous logins or independent browser sessions.
Omit `--write` for authenticated list/session reads only. This HTTP exercise
does not measure browser rendering, attachments, signing or analytics.

### Rehearsal on 2026-10-06

The new implementation passed local 60-second write exercises with both 50
and 75 independent sessions, including simultaneous logins. No HTTP requests
failed and every checked save advanced the expected revision. At 50 users,
login p95 was 1,091 ms and save p95 was 461 ms; at 75 users they were 1,568 ms
and 235 ms. These are short development-machine runs, not production capacity
claims. Temporary local limits of 200/300 were restored after the exercises.

The public demo's existing API image
`f56640efbc5a1ffbe74f24ae8406879dab9f63c5` completed a 120-second exercise with
50 simulated participants sharing one authenticated session: 1,170 saves,
600 active-report reads, and 400 list reads, with no HTTP failures. Save p95
was 2,263 ms, active-report p95 2,607 ms, and open-list p95 2,383 ms. All 50
generated drafts were deleted and the test session was logged out afterward.

This public run is the original `s-1vcpu-2gb` node baseline, with a single API
pod limited to 500m CPU and 512 MiB. Sampled API usage peaked at 0.306 CPU cores
and 77 MiB; node usage peaked at 0.757 CPU cores and 1,308 MiB. Another session
provisioned a new node pool during the exercise; the API remained on the
original node throughout the measured run. Rehearse again after the workload
has moved and the new login policy is deployed. The public run did not validate
50 independent logins, ingress admission of that burst, signing, or a full-length
group session.

The database contains only keyed digests. Raw usernames, source addresses,
forwarding headers, and user-agent strings are absent from the throttle table
and permanent authentication audit. Expired buckets are removed in bounded
batches during authentication traffic. Keep `AUTH_RATE_LIMIT_SECRET_BASE64`
separate from patient-key material, generate at least 32 random bytes, and make
the same value available to every API replica. Set `AUTH_TRUST_PROXY_HOPS` to
the exact number of trusted proxies (the chart defaults to one); never trust an
unbounded forwarded-for chain.

## Monitoring

Alert on a sustained rise in blocked account, network, or installation buckets
and correlate it with failed `authentication.sign_in`,
`authentication.password_change`, and `authentication.reauthenticate` audit
events. This aggregate query avoids returning keyed identifiers:

```sql
select scope,
       count(*) filter (where blocked_until > now()) as blocked,
       sum(attempt_count) as attempts,
       sum(failure_count) as failures,
       max(last_failure_at) as latest_failure
from app_identity.authentication_throttle
where expires_at > now()
group by scope
order by scope;
```

Investigate an installation-wide block immediately. A high number of account
buckets with failures but few network buckets indicates distributed guessing;
a single network bucket usually indicates a noisy client or local attack.

## Emergency override and recovery

Do not remove throttling as the first response. Confirm the incident, preserve
the aggregate counts above, and record the operator and reason. To recover from
a false-positive account lock without weakening network or installation
limits, an authorized database operator may clear only account buckets:

```sql
begin;
delete from app_identity.authentication_throttle where scope = 'account';
commit;
```

This is deliberately temporary: new failures recreate progressive evidence,
and network and installation protection remains active. If the NGINX layer is
misidentifying all clients as one address, set
`ingress.authenticationRateLimit.enabled=false` for one time-bounded Helm
release while correcting the ingress source-address configuration. The
database-backed controls remain active. Restore the ingress limit immediately
afterward and record the start/end time. Never disable both layers during an
active guessing incident.

Secret rotation changes every bucket key. Treat rotation as a global counter
reset: perform it only during a controlled deployment, retain the old aggregate
monitoring evidence, roll every replica together, and verify sign-in plus
password reauthentication after rollout.

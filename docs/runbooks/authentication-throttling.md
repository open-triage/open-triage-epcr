# Authentication throttling operations

OpenTriage applies two independent controls to every password verification path:

- The API stores atomic Postgres counters keyed by HMAC-SHA-256 digests of the
  normalized username, installation, and coarse network source. The account
  bucket begins progressive delays after three failures (1, 2, 4 seconds,
  capped at five minutes), allows at most 20 attempts per 15 minutes, and fully
  recovers after that window. Network buckets allow 60 attempts per five
  minutes; the installation bucket allows 300 per minute. A success records
  `last_success_at` but does not clear failures.
- The NGINX authentication Ingress limits `/api/sessions` to 10 requests per
  second per source with a three-times burst by default. The main API Ingress
  remains independent so clinical traffic is not subject to this safety limit.

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

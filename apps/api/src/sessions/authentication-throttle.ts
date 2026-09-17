import { createHmac } from "node:crypto";
import type { EntityManager } from "typeorm";
import { mutationRows } from "../database/mutation-result.js";

type Scope = "account" | "network" | "installation";
type Bucket = { scope: Scope; keyDigest: string; windowSeconds: number; maxAttempts: number };
type ThrottleRow = { scope: Scope; attempt_count: number | string; max_attempts: number | string; blocked_until: Date | string | null };
export type AuthenticationThrottle = { buckets: Bucket[] };

const RETENTION_MILLISECONDS = 24 * 60 * 60 * 1_000;
const DEVELOPMENT_SECRET = Buffer.from("open-triage-development-authentication-throttle-key-v1", "utf8");

function secret(): Buffer {
  const encoded = process.env.AUTH_RATE_LIMIT_SECRET_BASE64;
  if (!encoded) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_RATE_LIMIT_SECRET_BASE64 is required in production");
    }
    return DEVELOPMENT_SECRET;
  }
  const decoded = Buffer.from(encoded, "base64");
  if (decoded.length < 32) throw new Error("AUTH_RATE_LIMIT_SECRET_BASE64 must contain at least 32 random bytes");
  return decoded;
}

export function validateAuthenticationThrottleConfiguration(): void {
  secret();
}

function keyedDigest(scope: Scope, value: string): string {
  return createHmac("sha256", secret()).update(`open-triage-auth-throttle-v1\0${scope}\0${value}`).digest("hex");
}

function buckets(username: string, networkSource: string | undefined): Bucket[] {
  const result: Bucket[] = [
    { scope: "account", keyDigest: keyedDigest("account", username.trim().toLowerCase()), windowSeconds: 900, maxAttempts: 20 },
    { scope: "installation", keyDigest: keyedDigest("installation", "current"), windowSeconds: 60, maxAttempts: 300 }
  ];
  if (networkSource) {
    result.push({ scope: "network", keyDigest: keyedDigest("network", networkSource), windowSeconds: 300, maxAttempts: 60 });
  }
  return result.sort((left, right) => left.scope.localeCompare(right.scope));
}

export async function beginAuthenticationAttempt(manager: Pick<EntityManager, "query">, username: string,
  networkSource: string | undefined, now: Date): Promise<AuthenticationThrottle | undefined> {
  const attempt = { buckets: buckets(username, networkSource) };
  await manager.query(`delete from app_identity.authentication_throttle
    where ctid in (select ctid from app_identity.authentication_throttle
      where expires_at < $1 order by expires_at limit 100)`, [now]);
  const expiresAt = new Date(now.getTime() + RETENTION_MILLISECONDS);
  const parameters: unknown[] = [];
  const values = attempt.buckets.map((bucket) => {
    const offset = parameters.length;
    parameters.push(bucket.scope, bucket.keyDigest, bucket.windowSeconds, bucket.maxAttempts);
    return `($${offset + 1}::text, $${offset + 2}::text, $${offset + 3}::integer, $${offset + 4}::integer)`;
  }).join(", ");
  parameters.push(now, expiresAt);
  const nowParameter = `$${parameters.length - 1}`;
  const expiryParameter = `$${parameters.length}`;
  const rows = mutationRows<ThrottleRow>(await manager.query(`
    insert into app_identity.authentication_throttle
      (scope, key_digest, window_seconds, max_attempts, window_started_at,
       attempt_count, failure_count, last_attempt_at, expires_at)
    select input.scope, input.key_digest, input.window_seconds, input.max_attempts,
      ${nowParameter}, 1, 0, ${nowParameter}, ${expiryParameter}
    from (values ${values}) input(scope, key_digest, window_seconds, max_attempts)
    on conflict (scope, key_digest) do update set
      window_seconds = excluded.window_seconds,
      max_attempts = excluded.max_attempts,
      window_started_at = case
        when app_identity.authentication_throttle.window_started_at
          + app_identity.authentication_throttle.window_seconds * interval '1 second' <= excluded.window_started_at
        then excluded.window_started_at else app_identity.authentication_throttle.window_started_at end,
      attempt_count = case
        when app_identity.authentication_throttle.window_started_at
          + app_identity.authentication_throttle.window_seconds * interval '1 second' <= excluded.window_started_at
        then 1 else app_identity.authentication_throttle.attempt_count + 1 end,
      failure_count = case
        when app_identity.authentication_throttle.window_started_at
          + app_identity.authentication_throttle.window_seconds * interval '1 second' <= excluded.window_started_at
        then 0 else app_identity.authentication_throttle.failure_count end,
      blocked_until = case
        when app_identity.authentication_throttle.window_started_at
          + app_identity.authentication_throttle.window_seconds * interval '1 second' <= excluded.window_started_at
        then null else app_identity.authentication_throttle.blocked_until end,
      last_attempt_at = excluded.last_attempt_at,
      expires_at = excluded.expires_at
    returning scope, attempt_count, max_attempts, blocked_until
  `, parameters));
  const blocked = rows.some((row) => Number(row.attempt_count) > Number(row.max_attempts) ||
    (row.blocked_until !== null && new Date(row.blocked_until).getTime() > now.getTime()));
  return blocked ? undefined : attempt;
}

export async function finishAuthenticationAttempt(manager: Pick<EntityManager, "query">,
  attempt: AuthenticationThrottle, succeeded: boolean, now: Date): Promise<void> {
  const parameters: unknown[] = [];
  const values = attempt.buckets.map((bucket) => {
    const offset = parameters.length;
    parameters.push(bucket.scope, bucket.keyDigest);
    return `($${offset + 1}::text, $${offset + 2}::text)`;
  }).join(", ");
  parameters.push(now);
  const nowParameter = `$${parameters.length}`;
  if (succeeded) {
    await manager.query(`update app_identity.authentication_throttle throttle
      set last_success_at = ${nowParameter}::timestamptz
      from (values ${values}) input(scope, key_digest)
      where throttle.scope = input.scope and throttle.key_digest = input.key_digest`, parameters);
    return;
  }
  await manager.query(`update app_identity.authentication_throttle throttle set
      failure_count = throttle.failure_count + 1,
      last_failure_at = ${nowParameter}::timestamptz,
      blocked_until = case
        when throttle.scope = 'account' and throttle.failure_count + 1 >= 3
          then greatest(coalesce(throttle.blocked_until, '-infinity'::timestamptz),
            ${nowParameter}::timestamptz + least(300::numeric,
              power(2::numeric, least(throttle.failure_count - 2, 9))) * interval '1 second')
        when throttle.scope = 'network' and throttle.failure_count + 1 >= 25
          then greatest(coalesce(throttle.blocked_until, '-infinity'::timestamptz),
            ${nowParameter}::timestamptz + interval '30 seconds')
        when throttle.scope = 'installation' and throttle.failure_count + 1 >= 200
          then greatest(coalesce(throttle.blocked_until, '-infinity'::timestamptz),
            ${nowParameter}::timestamptz + interval '60 seconds')
        else throttle.blocked_until
      end
    from (values ${values}) input(scope, key_digest)
    where throttle.scope = input.scope and throttle.key_digest = input.key_digest`, parameters);
}

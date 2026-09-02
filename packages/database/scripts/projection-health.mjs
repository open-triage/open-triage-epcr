import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
const freshnessTargetSeconds = Number.parseInt(
  process.env.ANALYTICS_PROJECTOR_FRESHNESS_TARGET_SECONDS ?? "300",
  10
);

if (!databaseUrl) throw new Error("DATABASE_URL is required to inspect projection health");
if (!Number.isInteger(freshnessTargetSeconds) || freshnessTargetSeconds < 1) {
  throw new Error("ANALYTICS_PROJECTOR_FRESHNESS_TARGET_SECONDS must be a positive integer");
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();

try {
  const health = (await client.query("select * from operations.projection_health")).rows[0];
  const backlogAgeSeconds = health.oldest_backlog_age_seconds === null
    ? null
    : Number(health.oldest_backlog_age_seconds);
  const healthy = Number(health.persistent_failure_count) === 0 &&
    Number(health.stale_run_count) === 0 && health.last_run_status !== "failed" &&
    (backlogAgeSeconds === null || backlogAgeSeconds <= freshnessTargetSeconds);
  console.log(JSON.stringify({
    event: "analytics_projection_health",
    healthy,
    freshnessTargetSeconds,
    ...health,
    oldest_backlog_age_seconds: backlogAgeSeconds
  }));
  if (!healthy) process.exitCode = 1;
} catch (error) {
  const code = error && typeof error === "object" && "code" in error
    ? `database.${String(error.code).slice(0, 32)}`
    : "projector.HealthCheckError";
  console.log(JSON.stringify({ event: "analytics_projection_health", healthy: false, errorCode: code }));
  process.exitCode = 1;
} finally {
  await client.end();
}

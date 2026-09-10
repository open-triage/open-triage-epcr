// Safety guard for the scale-test harness (scripts/run-scale-tests.mjs).
//
// The harness starts by running `drop schema if exists scale_validation cascade` against
// whatever `DATABASE_URL` points at. That is safe against a disposable scratch database, but
// nothing about the harness itself stops someone from accidentally pointing it at a real
// installation's database. This module is the last checkpoint before that statement runs: it
// requires either a recognizable non-production marker in the connection string, or an explicit
// operator override, before allowing the caller to proceed.

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]", ""]);
const SCRATCH_DATABASE_NAME_MARKERS = ["scratch", "test", "sandbox", "scale_validation"];
export const SCALE_TEST_OVERRIDE_ENV_VAR = "SCALE_TEST_ALLOW_DESTRUCTIVE_RESET";

function redactCredentials(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    if (parsed.password) parsed.password = "***";
    if (parsed.username) parsed.username = "***";
    return parsed.toString();
  } catch {
    return "<unparseable connection string>";
  }
}

/**
 * Throws with a clear, actionable error unless `databaseUrl` is recognizable as a scratch/local
 * database, or the operator has explicitly opted in via SCALE_TEST_ALLOW_DESTRUCTIVE_RESET=1.
 * Must be called, and must complete without throwing, before any destructive statement runs.
 */
export function assertScratchDatabaseTarget(databaseUrl, { env = process.env } = {}) {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to run scale tests");

  if (env[SCALE_TEST_OVERRIDE_ENV_VAR] === "1") return;

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch (error) {
    throw new Error(
      `DATABASE_URL could not be parsed as a connection string (${error.message}). Refusing to ` +
        "run the destructive scale-test harness against it."
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  const databaseName = parsed.pathname.replace(/^\//, "").toLowerCase();
  const isLocalHost = LOCAL_HOSTNAMES.has(hostname);
  const hasScratchMarker = SCRATCH_DATABASE_NAME_MARKERS.some((marker) => databaseName.includes(marker));

  if (isLocalHost || hasScratchMarker) return;

  throw new Error(
    "Refusing to run the destructive scale-test harness (which starts with " +
      "`drop schema if exists scale_validation cascade`) against " +
      `DATABASE_URL "${redactCredentials(databaseUrl)}": it is not recognizable as a scratch ` +
      "database. The connection's host must be localhost/127.0.0.1, or its database name must " +
      `contain one of: ${SCRATCH_DATABASE_NAME_MARKERS.join(", ")}. If this really is a disposable ` +
      `database, set ${SCALE_TEST_OVERRIDE_ENV_VAR}=1 to confirm and proceed.`
  );
}

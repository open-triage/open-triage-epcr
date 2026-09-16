const TESTABLE_ROLES = new Set([
  "open_triage_analyst",
  "open_triage_auditor",
  "open_triage_feedback_retention",
  "open_triage_feedback_reviewer",
  "open_triage_identified_analyst",
  "open_triage_operational",
  "open_triage_query_auditor"
]);

export async function grantRoleForTesting(client, role) {
  if (!TESTABLE_ROLES.has(role)) {
    throw new Error(`Unsupported integration-test role ${role}`);
  }

  const version = await client.query("show server_version_num");
  const supportsMembershipOptions = Number(version.rows[0].server_version_num) >= 160000;
  const membershipOptions = supportsMembershipOptions
    ? " with set true, inherit false"
    : "";

  await client.query(`grant ${role} to current_user${membershipOptions}`);
}

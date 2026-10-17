// SQL fixtures for tests whose subject is analytical calculation rather than audit persistence.
// The actual runtime grants and failure paths are exercised by the audit suites.
export function withAnalyticsAuditQuery(query) {
  return async (sql, params) => {
    if (sql.includes("set_config('open_triage.audit_organization_id'")) return [];
    if (sql.includes("insert into clinical_audit.analytics_access_event")) return [{ id: "10000000-0000-4000-8000-000000000001" }];
    if (sql.includes("with recorded_access") && sql.includes("'analytics'")) return [{ recorded: new Set(params[4]).size }];
    return query(sql, params);
  };
}

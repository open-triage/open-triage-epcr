// Sources that already have UUID primary keys keep their existing public ID.
// Numeric sources use the permanent, database-generated audit_id instead.
const nativeUuidSources = new Set([
  "catalog.publication_event", "clinical_audit.analytics_access_event", "clinical.report_change",
  "clinical.review_amendment_policy_history", "clinical.review_assignment_history",
  "clinical.review_criterion_route_history", "clinical.review_overdue_history",
  "clinical.review_overdue_policy_history", "clinical.review_progress_history",
  "clinical.review_saved_analysis_history",
]);

export function auditEventIdColumn(source: string): "id" | "audit_id" {
  return nativeUuidSources.has(source) ? "id" : "audit_id";
}

-- Repair only unsigned records with authoritative real dispatch/incident provenance.
-- Signed records retain their immutable clinical history; ambiguous standalone history
-- and generated synthetic provenance are never guessed or relabeled.
update clinical.report report set synthetic=false
from clinical.call_assignment assignment, clinical.incident incident
where assignment.report_id=report.id and assignment.organization_id=report.organization_id
  and assignment.incident_id=report.incident_id and not assignment.synthetic
  and incident.id=report.incident_id and incident.organization_id=report.organization_id
  and not incident.synthetic and report.synthetic and report.status='draft'
  and report.synthetic_generated_by is null and report.synthetic_source_assignment_id is null
  and report.expires_at is null;

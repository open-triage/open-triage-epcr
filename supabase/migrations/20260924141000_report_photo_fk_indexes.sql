-- PostgreSQL does not create indexes for foreign keys. Cover every photo-note
-- tenant/user relationship used by joins, authorization, and cascades.
create index report_photo_note_organization_report_idx
on clinical.report_photo_note (organization_id, report_id);

create index report_photo_note_organization_created_by_idx
on clinical.report_photo_note (organization_id, created_by);

create index report_photo_note_organization_updated_by_idx
on clinical.report_photo_note (organization_id, updated_by);

create index report_photo_blob_organization_report_idx
on clinical.report_photo_blob (organization_id, report_id);

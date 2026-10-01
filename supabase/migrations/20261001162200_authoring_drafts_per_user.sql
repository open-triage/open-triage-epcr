-- Editable configuration belongs to its author. Published versions remain
-- organization-wide and keep their existing activation lifecycle.
drop index catalog.catalog_one_editable_draft_per_organization;
create unique index catalog_one_editable_draft_per_author
  on catalog.authoring_draft (organization_id, created_by)
  where published_release_id is null;

drop index forms.forms_one_editable_version_per_form;
create unique index forms_one_editable_version_per_author
  on forms.form_version (form_id, created_by)
  where status = 'draft';

drop index validation.validation_one_draft_per_organization_idx;
create unique index validation_one_draft_per_author_idx
  on validation.version (organization_id, created_by)
  where status = 'draft';

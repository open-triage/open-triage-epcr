-- Optimistic concurrency and one editable Stationary draft per form.

alter table forms.form_version
  add column revision integer not null default 1 check (revision >= 1),
  add column updated_at timestamptz not null default now();

create unique index forms_one_editable_version_per_form
  on forms.form_version (form_id) where status = 'draft';
create index forms_form_version_catalog_idx on forms.form_version (catalog_release_id);
create index forms_form_version_clone_idx on forms.form_version (cloned_from_id) where cloned_from_id is not null;

revoke all on table forms.form_version from public;

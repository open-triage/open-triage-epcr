-- Human-readable names are optional for historical/imported versions and required
-- by the administrator authoring APIs for newly published versions.
alter table catalog.release
  add column display_name text,
  add constraint catalog_release_display_name_valid check (
    display_name is null or (
      display_name = btrim(display_name)
      and char_length(display_name) between 1 and 120
    )
  );

alter table catalog.authoring_draft
  add column display_name text,
  add constraint catalog_authoring_draft_display_name_valid check (
    display_name is null or (
      display_name = btrim(display_name)
      and char_length(display_name) between 1 and 120
    )
  );

alter table forms.form_version
  add column display_name text,
  add constraint form_version_display_name_valid check (
    display_name is null or (
      display_name = btrim(display_name)
      and char_length(display_name) between 1 and 120
    )
  );

comment on column catalog.release.display_name is
  'Administrator-assigned human-readable name for this immutable catalog version.';
comment on column catalog.authoring_draft.display_name is
  'Administrator-assigned human-readable name carried into the published catalog version.';
comment on column forms.form_version.display_name is
  'Administrator-assigned human-readable name for this immutable form version.';

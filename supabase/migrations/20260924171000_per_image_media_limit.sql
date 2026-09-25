-- Add a separately configurable canonical-byte limit for each image while
-- retaining the existing aggregate photo-and-audio allowance per report.
alter table app_identity.agency_settings
  add column image_media_limit_bytes bigint;

update app_identity.agency_settings
set image_media_limit_bytes = least(10485760, report_media_allowance_bytes);

alter table app_identity.agency_settings
  alter column image_media_limit_bytes set default 10485760,
  alter column image_media_limit_bytes set not null,
  add constraint agency_settings_image_media_limit_range
    check (image_media_limit_bytes between 1048576 and 2147483648),
  add constraint agency_settings_image_media_limit_within_total
    check (image_media_limit_bytes <= report_media_allowance_bytes);

comment on column app_identity.agency_settings.image_media_limit_bytes is
  'Maximum canonical bytes allowed for one image; defaults to 10 MiB and cannot exceed the report aggregate.';

alter table app_identity.agency_settings_change_event
  add column old_image_media_limit_bytes bigint not null default 10485760
    check (old_image_media_limit_bytes between 1048576 and 2147483648),
  add column new_image_media_limit_bytes bigint not null default 10485760
    check (new_image_media_limit_bytes between 1048576 and 2147483648);

alter table app_identity.agency_settings_change_event
  alter column old_image_media_limit_bytes drop default,
  alter column new_image_media_limit_bytes drop default;

alter table clinical.report
  add column image_media_limit_bytes bigint not null default 10485760,
  add constraint report_image_media_limit_range
    check (image_media_limit_bytes between 1048576 and 2147483648);

comment on column clinical.report.image_media_limit_bytes is
  'Per-image policy pinned at report creation; historical signed reports receive the 10 MiB default without row mutation.';

create or replace function clinical.pin_report_media_settings()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  selected_settings app_identity.agency_settings%rowtype;
begin
  select * into selected_settings
  from app_identity.agency_settings
  where organization_id = new.organization_id;

  new.media_settings_revision := coalesce(selected_settings.revision, 1);
  new.report_media_allowance_bytes := coalesce(
    selected_settings.report_media_allowance_bytes, 52428800
  );
  new.image_media_limit_bytes := coalesce(
    selected_settings.image_media_limit_bytes, 10485760
  );
  return new;
end;
$$;

-- Agency-local presentation belongs to the revisioned settings aggregate.
-- The PNG is returned only as a bounded, validated data URL; audit history
-- records its digest rather than copying the asset.
alter table app_identity.agency_settings
  add column brand_text text not null default 'OpenTriage ePCR'
    check (char_length(btrim(brand_text)) between 1 and 100),
  add column helper_text text not null default 'Sign in with your agency-issued credentials.'
    check (char_length(btrim(helper_text)) between 1 and 300),
  add column logo_png_data_url text
    check (logo_png_data_url is null or (
      octet_length(logo_png_data_url) <= 174800 and
      logo_png_data_url ~ '^data:image/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$'
    )),
  add column accent_color text not null default '#00783a'
    check (accent_color ~ '^#[0-9a-f]{6}$'),
  add column accent_dark_color text not null default '#006b34'
    check (accent_dark_color ~ '^#[0-9a-f]{6}$'),
  add column browser_theme_color text not null default '#00783a'
    check (browser_theme_color ~ '^#[0-9a-f]{6}$'),
  add column pwa_background_color text not null default '#dfe5df'
    check (pwa_background_color ~ '^#[0-9a-f]{6}$'),
  add column pwa_name text not null default 'OpenTriage'
    check (char_length(btrim(pwa_name)) between 1 and 100),
  add column pwa_short_name text not null default 'OpenTriage'
    check (char_length(btrim(pwa_short_name)) between 1 and 30);

alter table app_identity.agency_settings_change_event
  add column old_brand_text text check (old_brand_text is null or char_length(old_brand_text) <= 100),
  add column new_brand_text text check (new_brand_text is null or char_length(new_brand_text) <= 100),
  add column old_helper_text text check (old_helper_text is null or char_length(old_helper_text) <= 300),
  add column new_helper_text text check (new_helper_text is null or char_length(new_helper_text) <= 300),
  add column old_logo_sha256 text check (old_logo_sha256 is null or old_logo_sha256 ~ '^[a-f0-9]{64}$'),
  add column new_logo_sha256 text check (new_logo_sha256 is null or new_logo_sha256 ~ '^[a-f0-9]{64}$'),
  add column old_accent_color text check (old_accent_color is null or old_accent_color ~ '^#[0-9a-f]{6}$'),
  add column new_accent_color text check (new_accent_color is null or new_accent_color ~ '^#[0-9a-f]{6}$'),
  add column old_accent_dark_color text check (old_accent_dark_color is null or old_accent_dark_color ~ '^#[0-9a-f]{6}$'),
  add column new_accent_dark_color text check (new_accent_dark_color is null or new_accent_dark_color ~ '^#[0-9a-f]{6}$'),
  add column old_browser_theme_color text check (old_browser_theme_color is null or old_browser_theme_color ~ '^#[0-9a-f]{6}$'),
  add column new_browser_theme_color text check (new_browser_theme_color is null or new_browser_theme_color ~ '^#[0-9a-f]{6}$'),
  add column old_pwa_background_color text check (old_pwa_background_color is null or old_pwa_background_color ~ '^#[0-9a-f]{6}$'),
  add column new_pwa_background_color text check (new_pwa_background_color is null or new_pwa_background_color ~ '^#[0-9a-f]{6}$'),
  add column old_pwa_name text check (old_pwa_name is null or char_length(old_pwa_name) <= 100),
  add column new_pwa_name text check (new_pwa_name is null or char_length(new_pwa_name) <= 100),
  add column old_pwa_short_name text check (old_pwa_short_name is null or char_length(old_pwa_short_name) <= 30),
  add column new_pwa_short_name text check (new_pwa_short_name is null or char_length(new_pwa_short_name) <= 30);

-- dAgency remains immutable canonical demographic data. A settings save that
-- changes it appends a new version; reports continue pinning the version that
-- was current when they were created.
create table app_identity.agency_demographic_change_event (
  id bigint generated always as identity primary key,
  organization_id uuid not null references app_identity.organization(id),
  actor_id uuid not null,
  settings_revision bigint not null check (settings_revision >= 2),
  prior_version_id uuid not null,
  version_id uuid not null,
  catalog_release_id uuid not null,
  old_definition_sha256 text not null check (old_definition_sha256 ~ '^[a-f0-9]{64}$'),
  new_definition_sha256 text not null check (new_definition_sha256 ~ '^[a-f0-9]{64}$'),
  old_dagency_01 text not null,
  new_dagency_01 text not null,
  old_dagency_02 text not null,
  new_dagency_02 text not null,
  old_dagency_04 text not null,
  new_dagency_04 text not null,
  old_dagency_04_display text,
  new_dagency_04_display text,
  old_dagency_04_system text,
  new_dagency_04_system text,
  old_dagency_04_terminology_version text,
  new_dagency_04_terminology_version text,
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, actor_id)
    references app_identity.app_user(organization_id, id),
  foreign key (organization_id, prior_version_id, catalog_release_id)
    references app_identity.agency_demographic_version(organization_id, id, catalog_release_id),
  foreign key (organization_id, version_id, catalog_release_id)
    references app_identity.agency_demographic_version(organization_id, id, catalog_release_id),
  check (prior_version_id <> version_id),
  check (char_length(old_dagency_01) between 1 and 50),
  check (char_length(new_dagency_01) between 1 and 50),
  check (char_length(old_dagency_02) between 1 and 15),
  check (char_length(new_dagency_02) between 1 and 15),
  check (old_dagency_04 ~ '^[0-9]{2}$'),
  check (new_dagency_04 ~ '^[0-9]{2}$'),
  check (old_dagency_04_display is null or char_length(old_dagency_04_display) <= 100),
  check (new_dagency_04_display is null or char_length(new_dagency_04_display) <= 100),
  check (old_dagency_04_system is null or old_dagency_04_system = 'ANSI-STATE'),
  check (new_dagency_04_system is null or new_dagency_04_system = 'ANSI-STATE'),
  check (old_dagency_04_terminology_version is null or char_length(old_dagency_04_terminology_version) <= 100),
  check (new_dagency_04_terminology_version is null or char_length(new_dagency_04_terminology_version) <= 100)
);

create index agency_demographic_change_event_organization_time_idx
  on app_identity.agency_demographic_change_event (organization_id, occurred_at desc, id desc);

create trigger agency_demographic_change_event_append_only
before update or delete on app_identity.agency_demographic_change_event
for each row execute function public.prevent_update_or_delete();

revoke all on app_identity.agency_demographic_change_event from public;

do $$
declare api_role text;
begin
  foreach api_role in array array['authenticator', 'anon', 'authenticated', 'service_role'] loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format('revoke all on table app_identity.agency_demographic_change_event from %I', api_role);
    end if;
  end loop;
end;
$$;

revoke all on app_identity.agency_demographic_change_event from open_triage_api_runtime;
grant select, insert on app_identity.agency_demographic_change_event to open_triage_api_runtime;
grant usage, select on sequence app_identity.agency_demographic_change_event_id_seq to open_triage_api_runtime;

create schema validation;
revoke all on schema validation from public;

create table validation.rule_identity (
  id uuid primary key,
  organization_id uuid not null references app_identity.organization(id),
  created_by uuid not null references app_identity.app_user(id),
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create index validation_rule_identity_organization_idx
  on validation.rule_identity (organization_id, created_at desc);

create trigger validation_rule_identity_immutable
before update or delete on validation.rule_identity
for each row execute function public.prevent_update_or_delete();

create table validation.version (
  id uuid primary key,
  organization_id uuid not null references app_identity.organization(id),
  catalog_release_id uuid not null references catalog.release(id),
  rule_id uuid not null,
  version integer,
  status text not null default 'draft' check (status in ('draft', 'published')),
  revision integer not null default 1 check (revision > 0),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  source_rule jsonb not null,
  compiled_bundle jsonb,
  compiled_sha256 text check (compiled_sha256 is null or compiled_sha256 ~ '^[a-f0-9]{64}$'),
  change_note text check (change_note is null or char_length(btrim(change_note)) between 1 and 1000),
  created_by uuid not null references app_identity.app_user(id),
  published_by uuid references app_identity.app_user(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  unique (organization_id, id),
  unique (organization_id, version),
  foreign key (organization_id, rule_id)
    references validation.rule_identity(organization_id, id),
  check ((status = 'draft' and version is null and compiled_bundle is null and compiled_sha256 is null
          and published_by is null and published_at is null)
      or (status = 'published' and version is not null and compiled_bundle is not null
          and compiled_sha256 is not null and change_note is not null
          and published_by is not null and published_at is not null))
);

create unique index validation_one_draft_per_organization_idx
  on validation.version (organization_id) where status = 'draft';
create index validation_version_catalog_release_idx
  on validation.version (catalog_release_id);
create index validation_version_rule_idx
  on validation.version (organization_id, rule_id);
create index validation_version_published_idx
  on validation.version (organization_id, version desc) where status = 'published';

create function validation.prevent_published_version_mutation()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or old.status = 'published' then
    raise exception 'published validation versions are immutable';
  end if;
  if new.id <> old.id or new.organization_id <> old.organization_id
     or new.catalog_release_id <> old.catalog_release_id or new.rule_id <> old.rule_id
     or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'validation version identity and catalog binding are immutable';
  end if;
  return new;
end;
$$;

create trigger validation_version_immutable
before update or delete on validation.version
for each row execute function validation.prevent_published_version_mutation();

create table validation.active_version (
  organization_id uuid primary key references app_identity.organization(id),
  validation_version_id uuid not null,
  form_version_id uuid not null references forms.form_version(id),
  activated_by uuid not null references app_identity.app_user(id),
  change_note text not null check (char_length(btrim(change_note)) between 1 and 1000),
  activated_at timestamptz not null default now(),
  foreign key (organization_id, validation_version_id)
    references validation.version(organization_id, id)
);

create index validation_active_version_id_idx
  on validation.active_version (validation_version_id);
create index validation_active_form_version_idx
  on validation.active_version (form_version_id);

alter table clinical.report
  add column validation_version_id uuid,
  add constraint report_validation_version_organization_fk
    foreign key (organization_id, validation_version_id)
    references validation.version(organization_id, id);

create index report_validation_version_idx
  on clinical.report (validation_version_id) where validation_version_id is not null;

create function clinical.validate_report_validation_pin()
returns trigger language plpgsql as $$
declare pinned validation.version%rowtype;
begin
  if tg_op = 'UPDATE' and new.validation_version_id is distinct from old.validation_version_id then
    raise exception 'report validation version is immutable';
  end if;
  if new.validation_version_id is null then return new; end if;
  select * into pinned from validation.version
    where organization_id = new.organization_id and id = new.validation_version_id;
  if pinned.status is distinct from 'published' or pinned.catalog_release_id <> new.catalog_release_id then
    raise exception 'report validation version must be published and bound to its pinned catalog';
  end if;
  return new;
end;
$$;

create trigger report_validation_pin_validate
before insert or update of validation_version_id on clinical.report
for each row execute function clinical.validate_report_validation_pin();

alter table clinical.signed_snapshot
  add column validation_version_id uuid,
  add constraint signed_snapshot_validation_version_fk
    foreign key (validation_version_id) references validation.version(id);

create function clinical.validate_signed_snapshot_validation_pin()
returns trigger language plpgsql as $$
declare pinned_version uuid;
begin
  select validation_version_id into pinned_version from clinical.report where id=new.report_id;
  if new.validation_version_id is distinct from pinned_version then
    raise exception 'signed validation version does not match report';
  end if;
  return new;
end;
$$;

create trigger signed_snapshot_validation_pin_validate
before insert on clinical.signed_snapshot
for each row execute function clinical.validate_signed_snapshot_validation_pin();

alter table clinical.validation_finding
  add column validation_version_id uuid references validation.version(id),
  add column validation_rule_id uuid references validation.rule_identity(id),
  add column execution_target text check (execution_target in ('live', 'sign', 'review')),
  add column target_element_id text,
  add column input_fingerprint text;

create index validation_finding_version_rule_idx
  on clinical.validation_finding (validation_version_id, validation_rule_id)
  where validation_version_id is not null;

comment on schema validation is
  'Organization-scoped authored validation sources and immutable compiled runtime bundles.';
comment on column clinical.report.validation_version_id is
  'Immutable validation policy selected with the report; null identifies a truthful legacy report.';

grant usage on schema validation to open_triage_api_runtime;
grant select, insert, update, delete on all tables in schema validation
  to open_triage_api_runtime;
alter default privileges in schema validation
  grant select, insert, update, delete on tables to open_triage_api_runtime;

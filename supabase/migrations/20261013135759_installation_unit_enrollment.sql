-- Installation authority is independent of clinician authentication. No roles or clinical data.
-- Stable installation identity is separate from immutable agency-scoped binding history.
-- Reassignment rotates credentials and creates another registration for this identity after revoking its old live binding.
create table app_identity.installation_identity (
 id uuid primary key,
 created_at timestamptz not null default clock_timestamp()
);
create table app_identity.installation_registration (
 id uuid primary key,
 installation_identity_id uuid not null references app_identity.installation_identity(id),
 organization_id uuid not null,
 unit_id uuid not null,
 name text not null check (length(btrim(name)) between 1 and 100),
 credential_sha256 text not null unique check (credential_sha256 ~ '^[a-f0-9]{64}$'),
 enrolled_at timestamptz not null default clock_timestamp(),
 revoked_at timestamptz,
 foreign key (organization_id,unit_id) references app_identity.operational_unit(organization_id,id),
 unique (organization_id,id)
);
create unique index installation_registration_one_live_idx on app_identity.installation_registration(installation_identity_id) where revoked_at is null;
create index installation_registration_identity_idx on app_identity.installation_registration(installation_identity_id,enrolled_at,id);
create index installation_registration_unit_idx on app_identity.installation_registration(organization_id,unit_id,id);
create table app_identity.unit_enrollment (
 id uuid primary key,
 organization_id uuid not null,
 unit_id uuid not null,
 issued_by uuid not null references app_identity.app_user(id),
 token_sha256 text not null unique check (token_sha256 ~ '^[a-f0-9]{64}$'),
 origin text not null,
 issued_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default (clock_timestamp()+interval '5 minutes'),
 consumed_at timestamptz,
 installation_id uuid,
 foreign key (organization_id,unit_id) references app_identity.operational_unit(organization_id,id),
 foreign key (organization_id,installation_id) references app_identity.installation_registration(organization_id,id),
 check (expires_at > issued_at),
 check ((consumed_at is null) = (installation_id is null))
);
create index unit_enrollment_unit_idx on app_identity.unit_enrollment(organization_id,unit_id);
create index unit_enrollment_actor_idx on app_identity.unit_enrollment(issued_by);
create index unit_enrollment_installation_idx on app_identity.unit_enrollment(organization_id,installation_id);
create table app_identity.installation_event (
 id bigint generated always as identity primary key,
 organization_id uuid not null,
 unit_id uuid not null,
 installation_id uuid,
 actor_id uuid not null references app_identity.app_user(id),
 event_type text not null check (event_type in ('enrollment-issued','installation-enrolled')),
 occurred_at timestamptz not null default clock_timestamp(),
 foreign key (organization_id,unit_id) references app_identity.operational_unit(organization_id,id),
 foreign key (organization_id,installation_id) references app_identity.installation_registration(organization_id,id)
);
create index installation_event_unit_idx on app_identity.installation_event(organization_id,unit_id,occurred_at,id);
create index installation_event_installation_idx on app_identity.installation_event(organization_id,installation_id);
create index installation_event_actor_idx on app_identity.installation_event(actor_id);
create trigger installation_event_append_only before update or delete on app_identity.installation_event
 for each row execute function public.prevent_update_or_delete();
revoke all on app_identity.installation_identity from public,open_triage_api_runtime;
grant select,insert on app_identity.installation_identity to open_triage_api_runtime;
revoke all on app_identity.installation_registration,app_identity.unit_enrollment,app_identity.installation_event from public,open_triage_api_runtime;
grant select,insert,update on app_identity.installation_registration,app_identity.unit_enrollment to open_triage_api_runtime;
grant select,insert on app_identity.installation_event to open_triage_api_runtime;
grant usage on sequence app_identity.installation_event_id_seq to open_triage_api_runtime;
-- Default workload grants are broad. Narrow earlier authentication/unit tables too.
revoke all on app_identity.group_authentication_policy,app_identity.operational_unit_event from open_triage_api_runtime;
grant select,insert,update on app_identity.group_authentication_policy to open_triage_api_runtime;
grant select,insert on app_identity.operational_unit_event to open_triage_api_runtime;

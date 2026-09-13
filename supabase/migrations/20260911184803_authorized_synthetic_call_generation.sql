alter table clinical.call_assignment
  add column synthetic_generated_by uuid;

alter table clinical.call_assignment
  add constraint call_assignment_synthetic_generator_check
    check (synthetic_generated_by is null or synthetic),
  add constraint call_assignment_synthetic_generator_fkey
    foreign key (organization_id, synthetic_generated_by)
    references app_identity.app_user (organization_id, id);

create unique index call_assignment_one_generated_unopened_per_user_unit_idx
  on clinical.call_assignment (organization_id, synthetic_generated_by, unit_id)
  where status = 'assigned' and synthetic_generated_by is not null;

create index call_assignment_synthetic_generator_idx
  on clinical.call_assignment (organization_id, synthetic_generated_by, created_at desc)
  where synthetic_generated_by is not null;

create function clinical.prevent_synthetic_generator_mutation()
returns trigger
language plpgsql
as $$
begin
  if old.synthetic_generated_by is distinct from new.synthetic_generated_by then
    raise exception 'synthetic assignment generator provenance is immutable';
  end if;
  return new;
end;
$$;

create trigger call_assignment_synthetic_generator_immutable
before update of synthetic_generated_by on clinical.call_assignment
for each row execute function clinical.prevent_synthetic_generator_mutation();

revoke all on function clinical.prevent_synthetic_generator_mutation() from public;

create table clinical_audit.synthetic_generation_event (
  id bigint generated always as identity primary key,
  organization_id uuid not null references app_identity.organization (id),
  actor_id uuid not null,
  unit_id uuid not null,
  assignment_id uuid not null,
  action text not null check (action in ('synthetic_call.generate', 'synthetic_call.reuse')),
  occurred_at timestamptz not null default now(),
  foreign key (organization_id, actor_id)
    references app_identity.app_user (organization_id, id),
  foreign key (organization_id, unit_id)
    references app_identity.operational_unit (organization_id, id)
);

create index synthetic_generation_event_organization_time_idx
  on clinical_audit.synthetic_generation_event (organization_id, occurred_at desc);

create index synthetic_generation_event_actor_time_idx
  on clinical_audit.synthetic_generation_event (actor_id, occurred_at desc);

create index synthetic_generation_event_unit_time_idx
  on clinical_audit.synthetic_generation_event (unit_id, occurred_at desc);

create trigger synthetic_generation_event_append_only
before update or delete on clinical_audit.synthetic_generation_event
for each row execute function public.prevent_update_or_delete();

revoke all on clinical_audit.synthetic_generation_event from public;

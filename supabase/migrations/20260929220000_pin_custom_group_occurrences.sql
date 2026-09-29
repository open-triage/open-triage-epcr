-- Bind each custom group and result to its report-pinned form and explicit parent.
create function clinical.validate_pinned_custom_group()
returns trigger language plpgsql as $$
declare
  definition jsonb;
  parent_key text;
  expected_parent text;
  pinned boolean;
  count_at_parent integer;
begin
  if new.source_kind <> 'custom' then return new; end if;
  select cgd.definition into definition from forms.custom_group_definition cgd
  where cgd.id = new.custom_group_definition_id;
  -- Legacy non-temporal groups predate catalog-authored grouping.
  if definition->>'recurrence' is null then return new; end if;
  select exists (
    select 1 from clinical.report r join catalog.release cr on cr.id = r.catalog_release_id
    cross join lateral jsonb_array_elements(coalesce(cr.provenance->'customGroupDefinitions','[]'::jsonb)) item
    where r.id = new.report_id and item->>'id' = new.custom_group_definition_id::text
      and item->>'namespace' = definition->>'namespace'
      and item->>'slug' = definition->>'slug'
      and item->>'recurrence' = definition->>'recurrence'
      and item->>'correlatesTo' is not distinct from definition->>'correlatesTo'
      and exists (select 1 from forms.form_field ff where ff.form_version_id = r.form_version_id
        and ff.custom_group_definition_id = new.custom_group_definition_id)
  ) into pinned;
  if not pinned then raise exception 'custom group % is absent from the report-pinned catalog or form', new.custom_group_definition_id; end if;
  expected_parent := coalesce(definition->>'correlatesTo', 'PatientCareReportGroup');
  select parent.group_id into parent_key from clinical.group_instance parent
  where parent.report_id = new.report_id and parent.id = new.parent_group_instance_id
    and parent.source_kind = 'nemsis' and parent.tombstoned_at is null;
  if parent_key is distinct from expected_parent then
    raise exception 'custom group % requires parent %, got %', new.group_id, expected_parent, parent_key;
  end if;
  if definition->>'recurrence' = 'single' and new.tombstoned_at is null then
    perform pg_advisory_xact_lock(hashtextextended(new.report_id::text || new.custom_group_definition_id::text || new.parent_group_instance_id::text, 0));
    select count(*) into count_at_parent from clinical.group_instance existing
    where existing.report_id = new.report_id and existing.custom_group_definition_id = new.custom_group_definition_id
      and existing.parent_group_instance_id = new.parent_group_instance_id
      and existing.id <> new.id and existing.tombstoned_at is null;
    if count_at_parent > 0 then raise exception 'custom group % permits one entry per parent', new.group_id; end if;
  end if;
  return new;
end;
$$;

drop trigger custom_occurrence_target_validate on clinical.element_occurrence;
create trigger custom_occurrence_target_validate
before insert or update of group_instance_id, element_identity_id, report_id, form_field_id
on clinical.element_occurrence for each row execute function clinical.validate_custom_occurrence_target();

create trigger pinned_custom_group_validate
before insert or update of parent_group_instance_id, custom_group_definition_id, report_id, tombstoned_at
on clinical.group_instance for each row execute function clinical.validate_pinned_custom_group();

create or replace function clinical.validate_custom_occurrence_target()
returns trigger language plpgsql as $$
declare
  target text;
  group_definition_id uuid;
  actual text;
  actual_definition_id uuid;
  actual_source text;
begin
  select ced.definition->>'correlatesTo', nullif(ced.definition->>'groupDefinitionId','')::uuid
    into target, group_definition_id from forms.custom_element_definition ced
  where ced.id = new.element_identity_id;
  if not found then return new; end if;
  if new.group_instance_id is null then raise exception 'custom result % requires a group instance', new.element_id; end if;
  select gi.group_id,gi.custom_group_definition_id,gi.source_kind into actual,actual_definition_id,actual_source
  from clinical.group_instance gi where gi.report_id = new.report_id and gi.id = new.group_instance_id;
  if group_definition_id is not null then
    if actual_source is distinct from 'custom' or actual_definition_id is distinct from group_definition_id then
      raise exception 'custom result % requires pinned custom group %, got %', new.element_id, group_definition_id, actual;
    end if;
    if not exists (select 1 from clinical.report r join forms.form_field ff on ff.form_version_id=r.form_version_id
      where r.id=new.report_id and ff.id=new.form_field_id
        and ff.custom_element_definition_id=new.element_identity_id
        and ff.custom_group_definition_id=group_definition_id) then
      raise exception 'custom result % requires its pinned form field and group', new.element_id;
    end if;
  elsif target is null then
    if actual <> 'PatientCareReportGroup' then raise exception 'standalone custom result % requires the report root', new.element_id; end if;
  elsif actual is distinct from target then
    raise exception 'custom result % requires correlation target %, got %', new.element_id, target, actual;
  end if;
  return new;
end;
$$;

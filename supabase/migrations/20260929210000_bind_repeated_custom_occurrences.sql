-- A custom result's group instance is its clinical correlation identity. The
-- pinned definition, rather than the form section, determines the target.
create function clinical.validate_custom_occurrence_target()
returns trigger language plpgsql as $$
declare
  target text;
  actual text;
begin
  select ced.definition->>'correlatesTo' into target
  from forms.custom_element_definition ced
  where ced.id = new.element_identity_id;
  if not found then return new; end if;
  if new.group_instance_id is null then
    raise exception 'custom result % requires a group instance', new.element_id;
  end if;
  select gi.group_id into actual from clinical.group_instance gi
  where gi.report_id = new.report_id and gi.id = new.group_instance_id;
  if target is null then
    if actual <> 'PatientCareReportGroup' then
      raise exception 'standalone custom result % requires the report root', new.element_id;
    end if;
  elsif actual is distinct from target then
    raise exception 'custom result % requires correlation target %, got %', new.element_id, target, actual;
  end if;
  return new;
end;
$$;

create trigger custom_occurrence_target_validate
before insert or update of group_instance_id, element_identity_id, report_id
on clinical.element_occurrence
for each row execute function clinical.validate_custom_occurrence_target();

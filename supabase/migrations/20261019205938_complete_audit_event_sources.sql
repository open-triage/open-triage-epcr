-- Keep audit inspection evidence compatible with the shared category catalog.
alter table clinical_audit.audit_read_event
  drop constraint audit_read_event_category_check,
  add constraint audit_read_event_category_check check (category in (
    'patient','authentication','authorization','configuration','clinical','media','recovery',
    'review','synthetic','installations','feedback','audit','analytics','integrations','combined')),
  drop constraint audit_read_event_queried_categories_check,
  add constraint audit_read_event_queried_categories_check check (
    (category <> 'combined' or (queried_categories is not null and cardinality(queried_categories) > 1))
    and (queried_categories is null or (
      inspection_kind = 'list'
      and cardinality(queried_categories) between 1 and 14
      and array_ndims(queried_categories) = 1
      and array_position(queried_categories, null) is null
      and queried_categories <@ array['patient','authentication','authorization','configuration','clinical',
        'media','recovery','review','synthetic','installations','feedback','audit','analytics','integrations']::text[]
      and (category = 'combined' or queried_categories = array[category])
    ))
  );

-- These existing ledgers were omitted from the original audit source catalog.
-- Give their rows stable public identifiers without exposing protected payloads.
do $$ declare source_name text;
begin
  foreach source_name in array array[
    'clinical_audit.post_signature_dispatch_delivery', 'clinical_audit.synthetic_purge_tombstone'
  ] loop
    execute format('alter table %s add column audit_id uuid not null default gen_random_uuid() unique', source_name::regclass);
    execute format('create trigger audit_id_immutable before update of audit_id on %s for each row execute function clinical_audit.reject_audit_id_change()', source_name::regclass);
  end loop;
end $$;
grant select (audit_id,report_id,dispatch_receipt_id,event_type,created_at)
  on clinical_audit.post_signature_dispatch_delivery to open_triage_api_runtime;
grant select (audit_id,record_id,record_type,organization_id,purged_at)
  on clinical_audit.synthetic_purge_tombstone to open_triage_api_runtime;

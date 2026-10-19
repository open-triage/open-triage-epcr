-- The unresolved item is committed with the signature, before any browser/network export.
alter table clinical.review_item
 drop constraint review_item_kind_check,
 add constraint review_item_kind_check check(kind in ('criterion','overdue-unsigned','missing-transmission-identifiers','cos-delivery-failed','eps-export')),
 add column eps_snapshot_id uuid references clinical.signed_snapshot(id) on delete cascade,
 add column eps_amendment_sequence integer,
 add constraint review_eps_sequence check(case when kind='eps-export' then eps_amendment_sequence is not null and eps_amendment_sequence>=0 else eps_amendment_sequence is null end),
 add constraint review_eps_context check((kind='eps-export')=(eps_snapshot_id is not null));
create index review_item_eps_snapshot on clinical.review_item(eps_snapshot_id) where eps_snapshot_id is not null;

create or replace function clinical.guard_transmission_completion() returns trigger language plpgsql as $$
begin
 if new.kind in ('missing-transmission-identifiers','cos-delivery-failed','eps-export') and new.active_match and new.status='completed' then
  raise exception 'Unresolved transmission requirements cannot be completed with a generic outcome';
 end if;
 return new;
end $$;

-- Findings share the append-only discussion audit and its existing private grants.
alter table clinical.review_comment
  add column kind text not null default 'comment'
  check (kind in ('comment', 'finding'));

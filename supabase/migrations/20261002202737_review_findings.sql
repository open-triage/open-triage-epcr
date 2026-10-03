-- Upgrade installations where discussion was already applied out of order.
-- Fresh installations receive the same column when discussion is created.
do $$
begin
  if to_regclass('clinical.review_comment') is not null then
    alter table clinical.review_comment
      add column if not exists kind text not null default 'comment'
      check (kind in ('comment', 'finding'));
  end if;
end;
$$;

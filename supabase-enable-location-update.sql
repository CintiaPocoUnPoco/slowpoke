-- 只有已經使用 Supabase 雲端同步時才需要執行。
-- 到 Supabase → SQL Editor 執行一次，讓網站可以修改已存地點。

alter table public.slowpoke_records enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'slowpoke_records'
      and policyname = 'anon can update slowpoke records'
  ) then
    create policy "anon can update slowpoke records"
    on public.slowpoke_records
    for update
    to anon
    using (true)
    with check (true);
  end if;
end
$$;

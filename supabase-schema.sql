-- 在 Supabase SQL Editor 執行這段

create table if not exists public.slowpoke_records (
  id uuid primary key,
  location_name text,
  message text,
  photo_url text not null,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now()
);

alter table public.slowpoke_records enable row level security;

-- 這是「私人小旅行、網址不公開」的簡易版政策。
-- 任何持有 anon key 的網站訪客都可讀寫。
-- 正式公開網站建議改用 Supabase Auth，再限制 auth.uid()。

create policy "anon can read slowpoke records"
on public.slowpoke_records
for select
to anon
using (true);

create policy "anon can insert slowpoke records"
on public.slowpoke_records
for insert
to anon
with check (true);

create policy "anon can delete slowpoke records"
on public.slowpoke_records
for delete
to anon
using (true);

-- 接著到 Storage 建立一個 bucket：
-- 名稱：slowpoke-photos
-- 設定為 Public bucket

-- Storage policies
create policy "anon can upload slowpoke photos"
on storage.objects
for insert
to anon
with check (bucket_id = 'slowpoke-photos');

create policy "public can view slowpoke photos"
on storage.objects
for select
to public
using (bucket_id = 'slowpoke-photos');

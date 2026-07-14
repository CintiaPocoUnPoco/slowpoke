-- 呆呆獸收集器：本機先玩、登入才備份
-- Supabase Dashboard → SQL Editor → New query → 貼上整份後執行。

create table if not exists public.backup_system_settings (
  id smallint primary key check (id = 1),
  backup_mode text not null default 'open'
    check (backup_mode in ('open', 'new_users_paused', 'all_uploads_paused')),
  updated_at timestamptz not null default now()
);

insert into public.backup_system_settings (id, backup_mode)
values (1, 'open')
on conflict (id) do nothing;

create table if not exists public.collector_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  collector_name text not null check (char_length(collector_name) between 1 and 36),
  is_custom boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.slowpoke_records (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  location_name text not null check (char_length(location_name) between 1 and 100),
  message text not null default '' check (char_length(message) <= 120),
  thumbnail_path text not null,
  display_path text not null,
  created_at timestamptz not null default now()
);

create index if not exists slowpoke_records_user_created_idx
on public.slowpoke_records (user_id, created_at desc);

alter table public.backup_system_settings enable row level security;
alter table public.collector_profiles enable row level security;
alter table public.slowpoke_records enable row level security;

grant select on public.backup_system_settings to anon, authenticated;
grant select, update on public.collector_profiles to authenticated;
grant select, insert, update, delete on public.slowpoke_records to authenticated;

drop policy if exists "backup mode is publicly readable" on public.backup_system_settings;
create policy "backup mode is publicly readable"
on public.backup_system_settings
for select
to anon, authenticated
using (true);

drop policy if exists "profiles select own" on public.collector_profiles;
drop policy if exists "profiles update own" on public.collector_profiles;
create policy "profiles select own"
on public.collector_profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "profiles update own"
on public.collector_profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- 收藏家資料只能透過 start_cloud_backup() 建立，避免空間關閉時繞過限制。
drop policy if exists "profiles insert own" on public.collector_profiles;

drop policy if exists "records select own" on public.slowpoke_records;
drop policy if exists "records insert own" on public.slowpoke_records;
drop policy if exists "records update own" on public.slowpoke_records;
drop policy if exists "records delete own" on public.slowpoke_records;

create policy "records select own"
on public.slowpoke_records
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "records insert own"
on public.slowpoke_records
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "records update own"
on public.slowpoke_records
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy "records delete own"
on public.slowpoke_records
for delete
to authenticated
using ((select auth.uid()) = user_id);

create or replace function public.start_cloud_backup(p_collector_name text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_mode text;
begin
  if v_user_id is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if exists (select 1 from public.collector_profiles where user_id = v_user_id) then
    return;
  end if;

  select backup_mode into v_mode
  from public.backup_system_settings
  where id = 1;

  if coalesce(v_mode, 'all_uploads_paused') <> 'open' then
    raise exception 'NEW_BACKUPS_PAUSED';
  end if;

  if char_length(trim(p_collector_name)) < 1 or char_length(trim(p_collector_name)) > 36 then
    raise exception 'INVALID_COLLECTOR_NAME';
  end if;

  insert into public.collector_profiles (user_id, collector_name, is_custom)
  values (v_user_id, trim(p_collector_name), false)
  on conflict (user_id) do nothing;
end;
$$;

grant execute on function public.start_cloud_backup(text) to authenticated;

create or replace function public.enforce_slowpoke_record_insert()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_mode text;
  v_count integer;
begin
  if auth.uid() is null or new.user_id <> auth.uid() then
    raise exception 'AUTH_REQUIRED';
  end if;

  if not exists (
    select 1 from public.collector_profiles where user_id = new.user_id
  ) then
    raise exception 'BACKUP_PROFILE_REQUIRED';
  end if;

  select backup_mode into v_mode
  from public.backup_system_settings
  where id = 1;

  if coalesce(v_mode, 'all_uploads_paused') = 'all_uploads_paused' then
    raise exception 'ALL_UPLOADS_PAUSED';
  end if;

  select count(*) into v_count
  from public.slowpoke_records
  where user_id = new.user_id;

  if v_count >= 18 then
    raise exception 'CLOUD_LIMIT_REACHED';
  end if;

  return new;
end;
$$;

drop trigger if exists slowpoke_record_insert_guard on public.slowpoke_records;
create trigger slowpoke_record_insert_guard
before insert on public.slowpoke_records
for each row execute function public.enforce_slowpoke_record_insert();

-- 私人照片空間。每張壓縮照片上限 600 KB，只接受 JPEG。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slowpoke-photos', 'slowpoke-photos', false, 600000, array['image/jpeg'])
on conflict (id) do update
set public = false,
    file_size_limit = 600000,
    allowed_mime_types = array['image/jpeg'];

create or replace function public.can_upload_slowpoke_photo(p_object_name text)
returns boolean
language plpgsql
security definer
stable
set search_path = public, storage, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_mode text;
  v_record_count integer;
  v_object_count integer;
begin
  if v_user_id is null then return false; end if;
  if split_part(p_object_name, '/', 1) <> v_user_id::text then return false; end if;
  if not exists (select 1 from public.collector_profiles where user_id = v_user_id) then return false; end if;

  select backup_mode into v_mode from public.backup_system_settings where id = 1;
  if coalesce(v_mode, 'all_uploads_paused') = 'all_uploads_paused' then return false; end if;

  select count(*) into v_record_count from public.slowpoke_records where user_id = v_user_id;
  if v_record_count >= 18 then return false; end if;

  select count(*) into v_object_count
  from storage.objects
  where bucket_id = 'slowpoke-photos'
    and split_part(name, '/', 1) = v_user_id::text;

  -- 每筆兩張：縮圖＋大圖，最多 18 筆，所以最多 36 個物件。
  return v_object_count < 36;
end;
$$;

grant execute on function public.can_upload_slowpoke_photo(text) to authenticated;

drop policy if exists "slowpoke photos select own" on storage.objects;
drop policy if exists "slowpoke photos insert own" on storage.objects;
drop policy if exists "slowpoke photos delete own" on storage.objects;

create policy "slowpoke photos select own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'slowpoke-photos'
  and split_part(name, '/', 1) = (select auth.uid()::text)
);

create policy "slowpoke photos insert own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'slowpoke-photos'
  and public.can_upload_slowpoke_photo(name)
);

create policy "slowpoke photos delete own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'slowpoke-photos'
  and split_part(name, '/', 1) = (select auth.uid()::text)
);

-- 管理者依 Supabase Dashboard 的 Storage Usage 手動切換：
-- 一般開放：
-- update public.backup_system_settings set backup_mode='open', updated_at=now() where id=1;
-- 約 70%：暫停新使用者開通備份，原有使用者仍可新增至 18 筆：
-- update public.backup_system_settings set backup_mode='new_users_paused', updated_at=now() where id=1;
-- 約 80%：暫停所有新增照片，原有使用者仍可查看、修改文字與刪除：
-- update public.backup_system_settings set backup_mode='all_uploads_paused', updated_at=now() where id=1;

-- 請依 Supabase Dashboard → Usage → Storage 的實際用量，選一段執行。

-- 0～70%：開放新使用者與既有使用者備份
update public.backup_system_settings
set backup_mode = 'open', updated_at = now()
where id = 1;

-- 約 70%：暫停新使用者開通；既有使用者仍可補到 18 筆
-- update public.backup_system_settings
-- set backup_mode = 'new_users_paused', updated_at = now()
-- where id = 1;

-- 約 80%：暫停所有新增照片；既有使用者仍可查看、修改文字與刪除
-- update public.backup_system_settings
-- set backup_mode = 'all_uploads_paused', updated_at = now()
-- where id = 1;

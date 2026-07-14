-- 選用：清除舊紀錄中可能已保存的精確經緯度
-- Supabase → SQL Editor → New query → 貼上後按 Run

update public.slowpoke_records
set latitude = null,
    longitude = null
where latitude is not null
   or longitude is not null;

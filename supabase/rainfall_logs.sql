-- =============================================================================
-- rainfall_logs — บันทึกฝน / Rainfall log (Data entry ขั้นที่ 3) ต่อ "กะ".
-- Run in Supabase (yaxgqcopshhukofmmgla) → SQL Editor → Run.
-- Idempotent. Additive (does not touch existing tables). Run AFTER schema.sql.
-- =============================================================================
-- 1 แถว = ช่วงฝน 1 ช่วง ในพื้นที่ 1 แห่ง เหมือน 1 บรรทัดในชีต Rainfall:
--   Area | Rainfall Intensity | Start Time | End Time | Period | Rain Duration
--   | Affect Opt | Start | End | Lost time Duration | Red Alert | Remark
--
-- Period / Rain Duration / Lost time Duration ไม่ได้เก็บในตาราง — คำนวณจาก
-- start/end ทั้งในหน้าจอและใน SQL ด้านล่าง (ค่าที่ derive ได้ไม่ควรเก็บซ้ำ
-- เพราะจะเพี้ยนเมื่อมีคนแก้เวลาแล้วลืมอัปเดต).
--
-- เวลาเก็บเป็น text 'HH:MM' (ไม่ใช่ type time) ให้ตรงกับค่าที่ <input type="time">
-- ส่งมา และให้ demo mode (in-memory client) เก็บค่าเดียวกันแบบ byte-for-byte.
-- ช่วงที่ข้ามเที่ยงคืน (กะกลางคืน เช่น 23:00 → 01:00) ถือว่า end < start แล้ว
-- บวก 24 ชั่วโมง — ดู duration_min ด้านล่าง.
--
-- area_code = ชื่อ "พื้นที่ใหญ่" ที่ฝนตก เช่น 'Copper Pit' / 'Gold Pit' (ไม่ใช่
-- pattern code แบบ NLU03A ที่ใช้ในขั้น 1-2 เพราะฝนตกทั้งพิท). ตัวเลือกมาจากตาราง
-- app_areas (supabase/app_areas.sql → หน้า Settings → App Area) แต่คอลัมน์นี้เก็บ
-- เป็น text ไม่ FK เหมือน production_plans.pattern_code เพื่อให้แถวที่บันทึกไปแล้ว
-- คงชื่อเดิมไว้ แม้ชื่อนั้นจะถูกแก้/ลบออกจาก master ภายหลัง.
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.rainfall_logs (
  id           uuid primary key default gen_random_uuid(),
  shift_id     uuid not null references public.shifts (id) on delete cascade,
  area_code    text not null default '',
  intensity    text not null default 'Clear'
               check (intensity in ('Clear', 'Light', 'Moderate', 'Heavy')),
  -- ช่วงที่ฝนตก
  start_time   text check (start_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  end_time     text check (end_time ~ '^[0-2][0-9]:[0-5][0-9]$'),
  -- กระทบงานหรือไม่ + ช่วงเวลาที่เสียไป
  affect_opt   boolean not null default false,
  affect_start text check (affect_start ~ '^[0-2][0-9]:[0-5][0-9]$'),
  affect_end   text check (affect_end ~ '^[0-2][0-9]:[0-5][0-9]$'),
  red_alert    boolean not null default false,
  remark       text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_rainfall_logs_shift
  on public.rainfall_logs (shift_id, created_at);

alter table public.rainfall_logs enable row level security;
drop policy if exists anon_all_rw on public.rainfall_logs;
create policy anon_all_rw on public.rainfall_logs
  for all to anon, authenticated using (true) with check (true);

-- มุมมองสำเร็จรูปสำหรับรายงาน: เติมคอลัมน์ที่ derive ได้ (Period / นาที) ให้ตรง
-- กับหน้าจอ. (end - start + 24h) % 24h รองรับช่วงที่ข้ามเที่ยงคืน.
create or replace view public.vw_rainfall_logs as
select
  r.id,
  s.shift_date,
  s.shift_type,
  r.area_code,
  r.intensity,
  r.start_time,
  r.end_time,
  case
    when r.start_time is null or r.end_time is null then null
    else r.start_time || '-' || r.end_time
  end as period,
  case
    when r.start_time is null or r.end_time is null then 0
    else (extract(epoch from ((r.end_time::time - r.start_time::time) + interval '24 hours')) / 60)::int % 1440
  end as rain_minutes,
  r.affect_opt,
  r.affect_start,
  r.affect_end,
  case
    when not r.affect_opt or r.affect_start is null or r.affect_end is null then 0
    else (extract(epoch from ((r.affect_end::time - r.affect_start::time) + interval '24 hours')) / 60)::int % 1440
  end as lost_minutes,
  r.red_alert,
  r.remark,
  r.created_at,
  r.updated_at
from public.rainfall_logs r
join public.shifts s on s.id = r.shift_id;

select count(*) as rainfall_rows from public.rainfall_logs;

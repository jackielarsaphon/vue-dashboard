-- =============================================================================
-- app_areas — "App Area" master: ชื่อพื้นที่ใหญ่ของเหมือง เช่น Copper Pit / Gold Pit
-- Run in Supabase (yaxgqcopshhukofmmgla) → SQL Editor → Run.
-- Idempotent. Additive (does not touch existing tables). Run AFTER schema.sql.
-- =============================================================================
-- mining_areas เก็บ "pattern code" ระดับย่อย (NLU03A, DSW04B) ที่ใช้ในขั้น 1-2 ของ
-- Data entry. ตารางนี้เก็บชื่อพื้นที่ระดับบน (พิท) ที่ใช้ในหน้า Settings → App Area
-- และเป็นตัวเลือกของคอลัมน์ Area ในขั้น 3 (Rainfall) เพราะฝนตกทั้งพิท ไม่ได้ตกราย
-- pattern. แยกตารางกัน ไม่แก้ mining_areas เดิม.
--
-- ลบ = soft delete (active = false) เพื่อให้ประวัติเดิมและชื่อที่เคยใช้ยังอยู่;
-- การเพิ่มชื่อเดิมซ้ำจะ upsert กลับมา active = true (ดู useAppAreas.js).
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.app_areas (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_areas enable row level security;
drop policy if exists anon_all_rw on public.app_areas;
create policy anon_all_rw on public.app_areas
  for all to anon, authenticated using (true) with check (true);

-- ค่าเริ่มต้นให้ dropdown ไม่ว่างตั้งแต่วันแรก (แก้/ลบ/เพิ่มได้จากหน้า Settings)
insert into public.app_areas (name)
values ('Copper Pit'), ('Gold Pit')
on conflict (name) do nothing;

select name, active from public.app_areas order by name;

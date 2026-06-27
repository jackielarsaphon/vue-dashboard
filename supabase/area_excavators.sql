-- =============================================================================
-- area_excavators — วาง excavator ลง "บ่อ" ได้หลายบ่อต่อ 1 ตัว (per-pit placement)
-- รันทั้งไฟล์นี้ใน Supabase (project yaxgqcopshhukofmmgla) → SQL Editor → Run
-- รันซ้ำได้ปลอดภัย (idempotent). ไม่แก้/ลบตารางเดิม — เพิ่มของใหม่อย่างเดียว.
-- =============================================================================
-- เดิม: excavators.mining_area_id เก็บได้ "บ่อเดียว" ต่อ 1 excavator → วางหลายบ่อ
-- ไม่ได้ และพอย้ายบ่อ ข้อมูลก็ดึงตามไปทั้งชุด.
-- ใหม่: ตารางนี้คือ "รายชื่อ excavator ของแต่ละบ่อ" (many-to-many) พร้อม
-- trucks/RL/note แยกตามบ่อ → ตัวเดียววางได้หลายบ่อ ข้อมูลแต่ละบ่ออยู่กับบ่อนั้น.
-- trips ยังอยู่ใน production_entries เดิม (มี mining_area_id ต่อแถวอยู่แล้ว).
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.area_excavators (
  id             uuid primary key default gen_random_uuid(),
  mining_area_id uuid not null references public.mining_areas (id) on delete cascade,
  excavator_id   uuid not null references public.excavators (id) on delete cascade,
  truck_count    integer not null default 0,
  rl_meters      numeric(10, 2),
  status         text not null default 'ok' check (status in ('ok', 'warn', 'alert')),
  notes          text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- กัน excavator ตัวเดียวซ้ำในบ่อเดียวกัน (แต่ต่างบ่อได้ = วางหลายบ่อได้)
  unique (mining_area_id, excavator_id)
);

create index if not exists idx_area_excavators_area on public.area_excavators (mining_area_id);
create index if not exists idx_area_excavators_exc  on public.area_excavators (excavator_id);

-- เปิด RLS อ่าน+เขียนให้ anon (เหมือนตารางอื่นในโปรเจกต์นี้)
alter table public.area_excavators enable row level security;
drop policy if exists anon_all_rw on public.area_excavators;
create policy anon_all_rw on public.area_excavators
  for all to anon, authenticated using (true) with check (true);

-- ย้ายการวางที่มีอยู่เดิม (excavators.mining_area_id) เข้ามาเป็นแถวเริ่มต้น
-- เพื่อให้หน้า Data entry ยังเห็น excavator เดิมในบ่อเดิมหลังเปลี่ยนระบบ.
insert into public.area_excavators (mining_area_id, excavator_id, truck_count, rl_meters, status, notes, active)
select e.mining_area_id, e.id, e.truck_count, e.rl_meters, e.status, e.notes, true
from public.excavators e
where e.mining_area_id is not null and e.active
on conflict (mining_area_id, excavator_id) do nothing;

-- ตรวจผล
select 'area_excavators' as tbl, count(*) as rows from public.area_excavators;

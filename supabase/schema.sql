-- =============================================================================
-- Production Daily Dashboard — Database Schema (PostgreSQL / Supabase)
-- =============================================================================
-- ระบบบันทึกผลผลิตเหมืองรายวัน: log จำนวนเที่ยว (trips) ของรถบรรทุกต่อรถขุด
-- (excavator) ราย "ชั่วโมง" ภายในแต่ละ "กะ" (shift) แล้วสรุปเป็นแดชบอร์ด
-- (Fleet / Area / Excavator views).
--
-- โครงสร้างแบ่งเป็น 3 กลุ่ม:
--   1) Master data : mining_areas, materials, dumping_areas, truck_models,
--                    excavators, users
--   2) Shift & plan : shifts, area_targets, shift_kpi_targets, production_plans
--   3) Fact table   : production_entries (หัวใจของระบบ — 1 แถว = 1 ช่องในตาราง
--                     กรอกข้อมูล: กะ x ชั่วโมง x รถขุด x วัสดุ x จุดทิ้ง x รุ่นรถ)
--
-- ทุก id เป็น uuid (default gen_random_uuid) ให้ตรงกับ src/lib/demoData.js และ
-- TS interfaces ใน src/stores/*.ts
-- รันไฟล์นี้ใน Supabase SQL Editor หรือผ่าน supabase CLI (migration).
-- =============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- =============================================================================
-- 1) MASTER DATA
-- =============================================================================

-- ผู้ใช้งานระบบ (ไม่ได้ใช้ Supabase Auth — เทียบ username/password ฝั่ง client)
-- หมายเหตุ: เก็บ password เป็น plaintext ตามที่ demo ทำอยู่. สำหรับ production
-- จริง ควรเปลี่ยนไปใช้ Supabase Auth หรืออย่างน้อยเก็บเป็น hash (เช่น bcrypt).
create table if not exists public.users (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  username   text not null unique,
  password   text not null,
  role       text not null default 'staff'
             check (role in ('admin', 'manager', 'staff')),
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- พื้นที่ทำเหมือง (pattern / area เช่น DSW04B, NLU03A)
create table if not exists public.mining_areas (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ชนิดวัสดุ (แร่ / ดิน-หินทิ้ง). is_waste = true หมายถึงเป็นดิน/หินทิ้ง (waste)
create table if not exists public.materials (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  is_waste    boolean not null default false,
  description text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- จุดทิ้งวัสดุ (dump). อาจผูกกับพื้นที่เหมืองหรือไม่ก็ได้
create table if not exists public.dumping_areas (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  mining_area_id uuid references public.mining_areas (id) on delete set null,
  active         boolean not null default true,
  created_at     timestamptz not null default now()
);

-- รุ่นรถบรรทุก + ความจุ (ตัน) สำหรับคำนวณ tonnes = trips * capacity.
-- capacity_tonnes ใช้เป็น factor เริ่มต้น/สำรอง เมื่อยังไม่มีค่ารายสัปดาห์ใน
-- truck_model_factors (ดูด้านล่าง).
create table if not exists public.truck_models (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  company         text,
  capacity_tonnes numeric(10, 2),
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ค่า factor (ตัน/เที่ยว) ราย "สัปดาห์" ต่อรุ่นรถ — TD&MVDC เปลี่ยนทุกสัปดาห์ จึง
-- เก็บเป็นประวัติแบบ effective-dated: week_start = วันจันทร์ของสัปดาห์ที่ค่าเริ่มมีผล.
-- แดชบอร์ดเลือก factor ของสัปดาห์ที่ตรงกับวันที่ของข้อมูล (carry-forward ค่าล่าสุด
-- ที่ week_start <= สัปดาห์นั้น) เพื่อให้ตันย้อนหลังคงเดิมแม้เปลี่ยน factor ปัจจุบัน.
-- ตารางนี้ "เพิ่มใหม่" ไม่กระทบ truck_models / production_entries เดิม.
create table if not exists public.truck_model_factors (
  id             uuid primary key default gen_random_uuid(),
  truck_model_id uuid not null references public.truck_models (id) on delete cascade,
  week_start     date not null,
  factor         numeric(10, 2) not null check (factor > 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (truck_model_id, week_start)
);
create index if not exists idx_truck_factors_model on public.truck_model_factors (truck_model_id, week_start);

-- รถขุด (roster เดียวใช้ร่วมทุกวัน). status ใช้แสดงไฟสถานะบนแดชบอร์ด.
-- การ "ลบ" ใช้ soft delete (active = false) เพราะ production_entries อ้างถึง
-- excavator_id โดยไม่ cascade.
create table if not exists public.excavators (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  company        text,
  mining_area_id uuid references public.mining_areas (id) on delete set null,
  truck_count    integer not null default 0,
  rl_meters      numeric(10, 2),
  status         text not null default 'ok'
                 check (status in ('ok', 'warn', 'alert')),
  notes          text,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- =============================================================================
-- 2) SHIFT & PLAN / TARGET
-- =============================================================================

-- กะการทำงาน: 1 วันมี 2 กะ (Day 06:00–19:00, Night 19:00–06:00).
-- unique (shift_date, shift_type) กันสร้างกะซ้ำ — useEntryStore จะ resolve/create
-- แถวกะตาม date+type ที่ผู้ใช้เลือก
create table if not exists public.shifts (
  id         uuid primary key default gen_random_uuid(),
  shift_date date not null,
  shift_type text not null check (shift_type in ('Day', 'Night')),
  created_at timestamptz not null default now(),
  unique (shift_date, shift_type)
);

-- เป้าหมายผลผลิต (ตัน) ราย "พื้นที่" ต่อกะ
create table if not exists public.area_targets (
  id             uuid primary key default gen_random_uuid(),
  shift_id       uuid not null references public.shifts (id) on delete cascade,
  mining_area_id uuid not null references public.mining_areas (id) on delete cascade,
  target_tonnes  numeric(12, 2) not null default 0,
  unique (shift_id, mining_area_id)
);

-- เป้าหมาย KPI การ์ดด้านบน (Total Production / Waste / ORE) ต่อกะ
create table if not exists public.shift_kpi_targets (
  id            uuid primary key default gen_random_uuid(),
  shift_id      uuid not null references public.shifts (id) on delete cascade,
  category      text not null check (category in ('production', 'waste', 'ore')),
  target_trip   integer,
  target_tonnes numeric(12, 2),
  unique (shift_id, category)
);

-- แผนผลิตจากต้นทาง (PLAN SOURCE): ดิน (soil) / แร่ (ore) ต่อ pattern_code ต่อกะ.
-- pattern_code อ้างถึง code ของ mining_areas แต่เก็บเป็น text ตาม demo (ไม่ FK)
-- เผื่อ pattern ที่ยังไม่มีในตาราง mining_areas
create table if not exists public.production_plans (
  id           uuid primary key default gen_random_uuid(),
  shift_id     uuid not null references public.shifts (id) on delete cascade,
  pattern_code text not null,
  soil_tonnes  numeric(12, 2) not null default 0,
  ore_tonnes   numeric(12, 2) not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (shift_id, pattern_code)
);

-- =============================================================================
-- 3) FACT TABLE — production_entries
-- =============================================================================
-- 1 แถว = จำนวนเที่ยวที่บันทึกใน 1 ช่อง: (กะ, ชั่วโมง, รถขุด, วัสดุ, จุดทิ้ง,
-- รุ่นรถ). tonnes มักคำนวณ trips * truck_models.capacity_tonnes (เก็บค่าไว้เลย
-- เพื่อ query แดชบอร์ดเร็ว และคงค่าเดิมแม้ความจุรุ่นรถถูกแก้ภายหลัง).
create table if not exists public.production_entries (
  id             uuid primary key default gen_random_uuid(),
  shift_id       uuid not null references public.shifts (id) on delete cascade,
  log_hour       integer not null check (log_hour between 0 and 23),
  excavator_id   uuid not null references public.excavators (id) on delete restrict,
  mining_area_id uuid not null references public.mining_areas (id) on delete restrict,
  material_id    uuid not null references public.materials (id) on delete restrict,
  dumping_area_id uuid not null references public.dumping_areas (id) on delete restrict,
  truck_model_id uuid not null references public.truck_models (id) on delete restrict,
  trips          integer not null default 0 check (trips >= 0),
  tonnes         numeric(12, 2),
  remark         text,
  created_by     uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- 1 ช่องในตารางกรอก = 1 แถว: กันบันทึกซ้ำสำหรับชุดมิติเดียวกัน
  unique (shift_id, log_hour, excavator_id, material_id, dumping_area_id, truck_model_id)
);

-- =============================================================================
-- INDEXES — เร่ง query ที่แดชบอร์ดใช้บ่อย
-- =============================================================================
-- โหลดข้อมูลทั้งกะ (DataEntry/FleetOverview) — กรองด้วย shift_id เป็นหลัก
create index if not exists idx_entries_shift        on public.production_entries (shift_id);
create index if not exists idx_entries_shift_hour   on public.production_entries (shift_id, log_hour);
-- มุมมองราย excavator / ราย area
create index if not exists idx_entries_excavator    on public.production_entries (excavator_id);
create index if not exists idx_entries_area         on public.production_entries (mining_area_id);
create index if not exists idx_entries_material     on public.production_entries (material_id);
-- เลือกกะตามวันที่ (TopBar date picker)
create index if not exists idx_shifts_date          on public.shifts (shift_date);
create index if not exists idx_plans_shift          on public.production_plans (shift_id);
create index if not exists idx_area_targets_shift   on public.area_targets (shift_id);

-- =============================================================================
-- updated_at trigger — แตะ updated_at อัตโนมัติเมื่อ UPDATE
-- =============================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_users_touch on public.users;
create trigger trg_users_touch before update on public.users
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_excavators_touch on public.excavators;
create trigger trg_excavators_touch before update on public.excavators
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_plans_touch on public.production_plans;
create trigger trg_plans_touch before update on public.production_plans
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_entries_touch on public.production_entries;
create trigger trg_entries_touch before update on public.production_entries
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_truck_factors_touch on public.truck_model_factors;
create trigger trg_truck_factors_touch before update on public.truck_model_factors
  for each row execute function public.touch_updated_at();

-- =============================================================================
-- ROW LEVEL SECURITY (หมายเหตุ)
-- =============================================================================
-- แอปนี้ใช้ publishable/anon key ฝั่ง client และไม่ได้ใช้ Supabase Auth
-- (auth.uid() จะเป็น null). ถ้าเปิด RLS ต้องเขียน policy ให้ anon เข้าถึงได้
-- มิฉะนั้น query ทั้งหมดจะคืนค่าว่าง. ตัวอย่าง "เปิดเต็มสำหรับ anon" (เหมาะกับ
-- เดโม/ระบบภายในเท่านั้น — production จริงควรย้ายไป Supabase Auth + policy ราย role):
--
--   alter table public.production_entries enable row level security;
--   create policy anon_all on public.production_entries
--     for all to anon using (true) with check (true);
--
-- ทำซ้ำกับทุกตาราง หรือ (ระหว่างพัฒนา) คง RLS ปิดไว้ก็ได้.
-- =============================================================================

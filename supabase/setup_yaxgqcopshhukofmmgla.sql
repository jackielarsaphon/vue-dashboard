-- =============================================================================
-- Setup script for Supabase project: yaxgqcopshhukofmmgla
-- รันทั้งไฟล์นี้ใน  SQL Editor → New query → Run
-- =============================================================================
-- โปรเจกต์นี้มี 11 ตารางครบแล้ว แต่:
--   (1) RLS เปิดให้ "อ่านอย่างเดียว" → แอป (anon key) เขียนข้อมูลไม่ได้
--   (2) ยังไม่มีตาราง material_routes
-- ไฟล์นี้แก้ทั้งสองอย่าง: เปิด policy อ่าน+เขียนให้ anon ทุกตาราง,
-- สร้าง material_routes + seed 77 routes. รันซ้ำได้ปลอดภัย (idempotent).
-- =============================================================================

create extension if not exists "pgcrypto";

-- ── 1) material_routes (ตารางที่ขาด) ────────────────────────────────────────
create table if not exists public.material_routes (
  id         uuid primary key default gen_random_uuid(),
  material   text not null default 'Ore' check (material in ('Ore', 'Waste')),
  ore_type   text not null,
  location   text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ── 2) เปิด RLS อ่าน+เขียนให้ anon ทุกตาราง ─────────────────────────────────
-- เพิ่ม policy แบบ permissive FOR ALL (using true / with check true) ซึ่งจะรวม
-- กับ policy เดิมแบบ OR → ทำให้ insert/update/delete ผ่านได้
-- (เหมาะกับระบบภายใน/ไม่มี Supabase Auth เท่านั้น)
do $$
declare t text;
begin
  foreach t in array array[
    'users','mining_areas','materials','dumping_areas','truck_models','excavators',
    'shifts','area_targets','shift_kpi_targets','production_plans','production_entries',
    'material_routes'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists anon_all_rw on public.%I;', t);
    execute format(
      'create policy anon_all_rw on public.%I for all to anon, authenticated using (true) with check (true);',
      t
    );
  end loop;
end $$;

-- ── 3) seed material_routes (45 Ore + 32 Waste = 77) ────────────────────────
with ore as (
  select p.prefix || g1.g || g2.g as ore_type,
         row_number() over (order by p.ord, g1.ord, g2.ord) - 1 as idx
  from (values ('AP',1),('BP',2),('CP',3),('LT',4),('MG',5)) as p(prefix,ord)
  cross join (values ('H',1),('L',2),('M',3)) as g1(g,ord)
  cross join (values ('H',1),('L',2),('M',3)) as g2(g,ord)
),
ore_dest(i, loc) as (
  values (0,'ROMA181'),(1,'ROMA174'),(2,'ROMA137'),(3,'ROMA138'),(4,'ROMA134')
)
insert into public.material_routes (material, ore_type, location)
select 'Ore', o.ore_type, d.loc
from ore o join ore_dest d on d.i = (o.idx % 5)
where (select count(*) from public.material_routes) = 0;

insert into public.material_routes (material, ore_type, location)
select 'Waste', p.prefix || s.suf, d.loc
from (values ('WN'),('WP'),('WH'),('WL')) as p(prefix)
cross join (values ('AF'),('BF')) as s(suf)
cross join (values ('DSWSA124'),('LSQ_WD'),('NMK03A_INPIT_BACKFIL'),('ROCK_SP')) as d(loc)
where (select count(*) from public.material_routes where material = 'Waste') = 0;

-- ── 4) ตรวจผล ───────────────────────────────────────────────────────────────
select 'material_routes' as tbl, count(*) from public.material_routes;

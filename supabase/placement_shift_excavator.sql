-- =============================================================================
-- placement_shift_excavator — override "excavator ของ placement นี้ในกะนี้"
-- รันทั้งไฟล์นี้ใน Supabase (project yaxgqcopshhukofmmgla) → SQL Editor → Run
-- รันซ้ำได้ปลอดภัย (idempotent). ไม่แก้/ลบตารางเดิม — เพิ่มตารางใหม่อย่างเดียว.
-- =============================================================================
-- ปัญหา: area_excavators เก็บ 1 แถวต่อ (บ่อ + excavator) แบบ global (ไม่มี shift)
-- → excavator ตัวเดียวที่ทำงานทั้งสองกะในบ่อเดียวกันคือ placement แถวเดียว
-- การ relabel (เปลี่ยนชื่อ) ในกะนึงจึงไปกระทบอีกกะ.
-- ใหม่: ตารางนี้คือ "override" ว่า placement หนึ่งในกะหนึ่ง (Day/Night) ให้แสดง
-- เป็น excavator ตัวไหน. ถ้าไม่มีแถว override → ใช้ area_excavators.excavator_id เดิม.
-- => relabel ในกะ Night เขียน override เฉพาะ Night, กะ Day ไม่ถูกแตะ.
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.placement_shift_excavator (
  id            uuid primary key default gen_random_uuid(),
  placement_id  uuid not null references public.area_excavators (id) on delete cascade,
  shift_type    text not null check (shift_type in ('Day', 'Night')),
  excavator_id  uuid not null references public.excavators (id) on delete cascade,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- 1 override ต่อ (placement, กะ)
  unique (placement_id, shift_type)
);

create index if not exists idx_pse_placement on public.placement_shift_excavator (placement_id);

-- เปิด RLS อ่าน+เขียนให้ anon (เหมือนตารางอื่นในโปรเจกต์นี้ ไม่งั้น write ติด 401)
alter table public.placement_shift_excavator enable row level security;
drop policy if exists anon_all_rw on public.placement_shift_excavator;
create policy anon_all_rw on public.placement_shift_excavator
  for all to anon, authenticated using (true) with check (true);

-- ตรวจผล
select 'placement_shift_excavator' as tbl, count(*) as rows from public.placement_shift_excavator;

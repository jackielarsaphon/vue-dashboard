-- =============================================================================
-- entry_dig_blocks — "Dig block" PER TRIP ROW in the Data entry grid.
-- Run in Supabase (yaxgqcopshhukofmmgla) → SQL Editor → Run. Idempotent. Additive
-- (does not touch existing tables). Run AFTER production_entries_placement.sql.
-- =============================================================================
-- The Data entry trip modal keys one row per (material type + ore type + dig block
-- + destination + dump model). Everything except the dig block already lives in
-- production_entries; rather than ALTER that fact table, the dig block is kept
-- here under the SAME row identity, so:
--   • a dig block can be typed BEFORE any trips are entered (production_entries
--     only ever holds rows with trips > 0),
--   • clearing the trips does not wipe the dig block,
--   • nothing existing changes shape.
-- One row per (shift, hour, placement, material, dumping area, truck model) — the
-- production_entries unique key minus excavator_id (which the placement implies).
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.entry_dig_blocks (
  id              uuid primary key default gen_random_uuid(),
  shift_id        uuid not null references public.shifts (id) on delete cascade,
  log_hour        integer not null check (log_hour between 0 and 23),
  placement_id    uuid not null references public.area_excavators (id) on delete cascade,
  material_id     uuid not null references public.materials (id) on delete cascade,
  dumping_area_id uuid not null references public.dumping_areas (id) on delete cascade,
  truck_model_id  uuid not null references public.truck_models (id) on delete cascade,
  dig_block       text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (shift_id, log_hour, placement_id, material_id, dumping_area_id, truck_model_id)
);

-- The app reads a whole date at once, filtered by shift_id (see fetchDateEntries).
create index if not exists idx_entry_dig_blocks_lookup
  on public.entry_dig_blocks (shift_id, log_hour);

alter table public.entry_dig_blocks enable row level security;
drop policy if exists anon_all_rw on public.entry_dig_blocks;
create policy anon_all_rw on public.entry_dig_blocks
  for all to anon, authenticated using (true) with check (true);

select count(*) as dig_block_rows from public.entry_dig_blocks;

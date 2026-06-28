-- =============================================================================
-- placement_removed — marks the hour an excavator placement LEFT a pit, per shift.
-- Run in Supabase (yaxgqcopshhukofmmgla) → SQL Editor → Run. Idempotent. Additive
-- (does not touch existing tables). Run AFTER area_excavators.sql.
-- =============================================================================
-- The "x" button used to delete the whole placement row, which cascade-deleted its
-- trips / RL / notes for EVERY hour (so earlier hours lost their data). Instead we
-- record a removal point: the placement is hidden from this (shift, hour) onward,
-- while the hours it actually worked keep all their data. One removal point per
-- placement per shift; re-adding the excavator creates a fresh placement row.
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.placement_removed (
  id           uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.area_excavators (id) on delete cascade,
  shift_id     uuid not null references public.shifts (id) on delete cascade,
  log_hour     integer not null check (log_hour between 0 and 23),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (placement_id, shift_id)
);

create index if not exists idx_placement_removed_lookup
  on public.placement_removed (shift_id);

alter table public.placement_removed enable row level security;
drop policy if exists anon_all_rw on public.placement_removed;
create policy anon_all_rw on public.placement_removed
  for all to anon, authenticated using (true) with check (true);

select count(*) as removed_rows from public.placement_removed;

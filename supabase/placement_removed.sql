-- =============================================================================
-- placement_removed — marks an excavator placement as removed for ONE hour.
-- Run in Supabase (yaxgqcopshhukofmmgla) → SQL Editor → Run. Idempotent. Additive
-- (does not touch existing tables). Run AFTER area_excavators.sql.
-- =============================================================================
-- The "x" button used to delete the whole placement row, which cascade-deleted its
-- trips / RL / notes for EVERY hour. Instead we record a removal per (placement,
-- shift, hour): the placement is hidden for that one hour only — every other hour,
-- before and after, keeps its data. Re-adding the excavator creates a fresh row.
--
-- NOTE: an earlier version keyed this table by (placement_id, shift_id) for a
-- "from this hour onward" behaviour. We now key it per hour, so this script drops
-- and recreates the table (it only holds transient UI state — safe to reset).
-- =============================================================================

create extension if not exists "pgcrypto";

drop table if exists public.placement_removed cascade;

create table public.placement_removed (
  id           uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.area_excavators (id) on delete cascade,
  shift_id     uuid not null references public.shifts (id) on delete cascade,
  log_hour     integer not null check (log_hour between 0 and 23),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (placement_id, shift_id, log_hour)
);

create index if not exists idx_placement_removed_lookup
  on public.placement_removed (shift_id, log_hour);

alter table public.placement_removed enable row level security;
drop policy if exists anon_all_rw on public.placement_removed;
create policy anon_all_rw on public.placement_removed
  for all to anon, authenticated using (true) with check (true);

select count(*) as removed_rows from public.placement_removed;

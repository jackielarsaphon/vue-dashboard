-- =============================================================================
-- placement_trucks — Trucks in fleet PER (excavator placement + shift + hour).
-- Run in Supabase (yaxgqcopshhukofmmgla) → SQL Editor → Run. Idempotent. Additive
-- (does not touch existing tables). Run AFTER area_excavators.sql.
-- =============================================================================
-- Trucks used to live on area_excavators.truck_count (one value per placement,
-- shared across every hour, so editing one hour changed them all). This table lets
-- each hour have its own truck count — editing this hour never rewrites any other
-- hour. Nothing is auto-carried between hours: an hour is blank until keyed.
-- Existing truck counts are backfilled onto the hours that already have trips so
-- current values stay visible.
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.placement_trucks (
  id           uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.area_excavators (id) on delete cascade,
  shift_id     uuid not null references public.shifts (id) on delete cascade,
  log_hour     integer not null check (log_hour between 0 and 23),
  truck_count  integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (placement_id, shift_id, log_hour)
);

create index if not exists idx_placement_trucks_lookup
  on public.placement_trucks (shift_id, log_hour);

alter table public.placement_trucks enable row level security;
drop policy if exists anon_all_rw on public.placement_trucks;
create policy anon_all_rw on public.placement_trucks
  for all to anon, authenticated using (true) with check (true);

-- Backfill: put each placement's existing (global) truck count onto every
-- (shift, hour) where that placement already logged trips, so current values stay
-- visible on the hours that already have data.
insert into public.placement_trucks (placement_id, shift_id, log_hour, truck_count)
select distinct pe.placement_id, pe.shift_id, pe.log_hour, ae.truck_count
from public.production_entries pe
join public.area_excavators ae on ae.id = pe.placement_id
where pe.placement_id is not null
  and ae.truck_count is not null
  and ae.truck_count > 0
on conflict (placement_id, shift_id, log_hour) do nothing;

select count(*) as truck_rows from public.placement_trucks;

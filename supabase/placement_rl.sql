-- =============================================================================
-- placement_rl — RL / bench level PER (excavator placement + shift + hour).
-- Run in Supabase (yaxgqcopshhukofmmgla) → SQL Editor → Run. Idempotent. Additive
-- (does not touch existing tables). Run AFTER area_excavators.sql.
-- =============================================================================
-- RL used to live on area_excavators.rl_meters (one value per placement, shared
-- across every hour, so editing one hour changed them all). This table lets each
-- hour have its own RL — editing this hour never rewrites earlier hours, and a
-- fresh hour carries forward the most recent earlier reading. Existing RL values
-- are backfilled onto the hours that already have trips so nothing is lost.
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.placement_rl (
  id           uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.area_excavators (id) on delete cascade,
  shift_id     uuid not null references public.shifts (id) on delete cascade,
  log_hour     integer not null check (log_hour between 0 and 23),
  rl_meters    numeric,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (placement_id, shift_id, log_hour)
);

create index if not exists idx_placement_rl_lookup
  on public.placement_rl (shift_id, log_hour);

alter table public.placement_rl enable row level security;
drop policy if exists anon_all_rw on public.placement_rl;
create policy anon_all_rw on public.placement_rl
  for all to anon, authenticated using (true) with check (true);

-- Backfill: put each placement's existing (global) RL onto every (shift, hour)
-- where that placement already logged trips, so current RL stays visible.
insert into public.placement_rl (placement_id, shift_id, log_hour, rl_meters)
select distinct pe.placement_id, pe.shift_id, pe.log_hour, ae.rl_meters
from public.production_entries pe
join public.area_excavators ae on ae.id = pe.placement_id
where pe.placement_id is not null
  and ae.rl_meters is not null
on conflict (placement_id, shift_id, log_hour) do nothing;

select count(*) as rl_rows from public.placement_rl;

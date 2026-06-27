-- =============================================================================
-- placement_notes — Production note PER (excavator placement + shift + hour).
-- Run in Supabase (yaxgqcopshhukofmmgla) → SQL Editor → Run. Idempotent. Additive
-- (does not touch existing tables). Run AFTER area_excavators.sql.
-- =============================================================================
-- The note used to live on area_excavators.notes (one note per excavator, shared
-- across every hour). This table lets each hour have its own note — a new hour
-- starts blank. Existing notes are backfilled onto the hours that already have
-- trips so nothing is lost.
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.placement_notes (
  id           uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.area_excavators (id) on delete cascade,
  shift_id     uuid not null references public.shifts (id) on delete cascade,
  log_hour     integer not null check (log_hour between 0 and 23),
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (placement_id, shift_id, log_hour)
);

create index if not exists idx_placement_notes_lookup
  on public.placement_notes (shift_id, log_hour);

alter table public.placement_notes enable row level security;
drop policy if exists anon_all_rw on public.placement_notes;
create policy anon_all_rw on public.placement_notes
  for all to anon, authenticated using (true) with check (true);

-- Backfill: put each placement's existing (global) note onto every (shift, hour)
-- where that placement already logged trips, so current notes stay visible.
insert into public.placement_notes (placement_id, shift_id, log_hour, note)
select distinct pe.placement_id, pe.shift_id, pe.log_hour, ae.notes
from public.production_entries pe
join public.area_excavators ae on ae.id = pe.placement_id
where pe.placement_id is not null
  and ae.notes is not null
  and btrim(ae.notes) <> ''
on conflict (placement_id, shift_id, log_hour) do nothing;

select count(*) as note_rows from public.placement_notes;

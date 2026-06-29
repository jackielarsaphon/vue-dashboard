-- =============================================================================
-- placement_editors — WHO added and WHO last edited a placement's data, PER
-- (excavator placement + shift + hour). Drives the "added by / edited by" labels
-- on the Data entry excavator rows.
-- Run in Supabase (yaxgqcopshhukofmmgla) → SQL Editor → Run. Idempotent. Additive
-- (does not touch existing tables). Run AFTER area_excavators.sql. Safe to re-run
-- if you ran an earlier version — it just adds the created_by column.
-- =============================================================================
-- created_by = who first keyed this row (the "+ Add excavator" / first entry),
-- set once and never overwritten. edited_by = who last touched it (last write
-- wins). So the UI can show two names when a different person edits later.
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.placement_editors (
  id           uuid primary key default gen_random_uuid(),
  placement_id uuid not null references public.area_excavators (id) on delete cascade,
  shift_id     uuid not null references public.shifts (id) on delete cascade,
  log_hour     integer not null check (log_hour between 0 and 23),
  created_by   uuid references public.users (id) on delete set null,
  edited_by    uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (placement_id, shift_id, log_hour)
);

-- Add created_by for installs that ran the earlier (edited_by-only) version.
alter table public.placement_editors add column if not exists created_by uuid references public.users (id) on delete set null;

create index if not exists idx_placement_editors_lookup
  on public.placement_editors (shift_id, log_hour);

alter table public.placement_editors enable row level security;
drop policy if exists anon_all_rw on public.placement_editors;
create policy anon_all_rw on public.placement_editors
  for all to anon, authenticated using (true) with check (true);

-- Backfill: seed both added-by and edited-by from production_entries.created_by
-- on the hours that already logged trips, so existing data shows names straight away.
insert into public.placement_editors (placement_id, shift_id, log_hour, created_by, edited_by)
select distinct pe.placement_id, pe.shift_id, pe.log_hour, pe.created_by, pe.created_by
from public.production_entries pe
where pe.placement_id is not null
  and pe.created_by is not null
on conflict (placement_id, shift_id, log_hour) do nothing;

select count(*) as editor_rows from public.placement_editors;

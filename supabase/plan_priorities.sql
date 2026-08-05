-- =============================================================================
-- plan_priorities — Priority (a rank, 1–99) PER (pattern_code + shift), alongside the
-- daily Plan Production. Run in Supabase (yaxgqcopshhukofmmgla) → SQL Editor → Run.
-- Idempotent. Additive (does not touch existing tables). Run AFTER schema.sql.
--
-- The range was 1–4 originally. If this table already exists with that narrower
-- check, run supabase/plan_priorities_widen.sql to lift it — `create table if not
-- exists` below leaves an existing table's constraints untouched.
-- =============================================================================
-- Plan Production entered soil/ore per pattern in production_plans. This table adds
-- a hand-set Priority for the same (shift, pattern) so the Fleet overview Production
-- report can colour pits by importance (1 = highest) instead of deriving it from
-- how far behind plan they are. Keyed exactly like production_plans; the app writes
-- to the canonical (Day) shift and merges both shifts on read.
-- =============================================================================

create extension if not exists "pgcrypto";

create table if not exists public.plan_priorities (
  id           uuid primary key default gen_random_uuid(),
  shift_id     uuid not null references public.shifts (id) on delete cascade,
  pattern_code text not null,
  priority     integer check (priority between 1 and 99),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (shift_id, pattern_code)
);

create index if not exists idx_plan_priorities_shift
  on public.plan_priorities (shift_id);

alter table public.plan_priorities enable row level security;
drop policy if exists anon_all_rw on public.plan_priorities;
create policy anon_all_rw on public.plan_priorities
  for all to anon, authenticated using (true) with check (true);

select count(*) as priority_rows from public.plan_priorities;

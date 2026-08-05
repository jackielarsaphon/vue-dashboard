-- =============================================================================
-- plan_priorities — widen Priority from 1–4 to 1–99.
-- Run in Supabase (yaxgqcopshhukofmmgla) → SQL Editor → Run. Idempotent.
-- =============================================================================
-- Priority started as a four-band urgency flag, so the column carried
-- `check (priority between 1 and 4)`. It is used as a RANK (1st, 2nd, 3rd … pit),
-- which needs to go past four once a site plans more than four pits a day, so this
-- replaces that check with a wider one.
--
-- Only the value RANGE changes: no column is added, dropped or retyped, and no row
-- can violate the wider range, so nothing already stored is touched or at risk.
-- (The app clamps to the same 1–99 — see PRIORITY_MAX in usePlanProduction.js.)
--
-- Until this runs, saving a Priority above 4 is rejected by the database and the
-- field simply keeps whatever was there — the rest of Plan Production is unaffected.
-- =============================================================================

-- Drop whichever check currently constrains priority (Postgres named the original
-- one automatically, so find it rather than guessing).
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
      from pg_constraint
     where conrelid = 'public.plan_priorities'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%priority%'
  loop
    execute format('alter table public.plan_priorities drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.plan_priorities
  add constraint plan_priorities_priority_range
  check (priority is null or priority between 1 and 99);

-- Verify: the new definition, and the range actually in use.
select pg_get_constraintdef(oid) as priority_check
  from pg_constraint
 where conrelid = 'public.plan_priorities'::regclass
   and conname = 'plan_priorities_priority_range';

select count(*) as priority_rows, min(priority) as lowest, max(priority) as highest
  from public.plan_priorities;

-- =============================================================================
-- Allow the SAME excavator to be placed MORE THAN ONCE in one pit, with separate
-- trips per row. Run AFTER area_excavators.sql, in Supabase (yaxgqcopshhukofmmgla)
-- → SQL Editor → Run. Idempotent / re-runnable. Additive: production_entries keeps
-- all its columns + data; we only ADD placement_id and re-scope its unique key.
-- =============================================================================
-- production_entries was unique per (shift, hour, excavator, material, dump, model)
-- — so one excavator couldn't have two rows of the same combo, even across two
-- placements in a pit. We add placement_id (which Data entry row a trip belongs to)
-- and make the unique key per-placement instead of per-excavator.
-- =============================================================================

-- 1) New column: which area_excavators placement (Data entry row) this trip is for.
alter table public.production_entries
  add column if not exists placement_id uuid references public.area_excavators (id) on delete set null;

-- 2) Backfill existing trips: match by (excavator, pit). At this point each pit has
--    at most one placement per excavator (area_excavators.unique still in force), so
--    the match is unambiguous.
update public.production_entries pe
set placement_id = ae.id
from public.area_excavators ae
where pe.placement_id is null
  and ae.excavator_id = pe.excavator_id
  and ae.mining_area_id = pe.mining_area_id;

-- 3) Re-scope the unique key from per-excavator to per-placement.
do $$
declare cname text;
begin
  -- drop the old 6-column unique (shift, hour, excavator, material, dump, model)
  select conname into cname
  from pg_constraint
  where conrelid = 'public.production_entries'::regclass
    and contype = 'u'
    and conkey @> array[
      (select attnum from pg_attribute where attrelid = 'public.production_entries'::regclass and attname = 'excavator_id')
    ]
  limit 1;
  if cname is not null then
    execute format('alter table public.production_entries drop constraint %I', cname);
  end if;
end $$;

create unique index if not exists production_entries_placement_combo_uidx
  on public.production_entries (shift_id, log_hour, placement_id, material_id, dumping_area_id, truck_model_id);

create index if not exists idx_entries_placement on public.production_entries (placement_id);

-- 4) Allow the same excavator to be placed more than once in a pit: drop the
--    unique(mining_area_id, excavator_id) constraint on area_excavators.
do $$
declare cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.area_excavators'::regclass
    and contype = 'u'
  limit 1;
  if cname is not null then
    execute format('alter table public.area_excavators drop constraint %I', cname);
  end if;
end $$;

select 'placement_id set' as info, count(*) filter (where placement_id is not null) as with_placement, count(*) as total
from public.production_entries;

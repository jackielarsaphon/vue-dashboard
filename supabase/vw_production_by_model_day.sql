-- =============================================================================
-- vw_production_by_model_day — รวมเที่ยว × รุ่นรถ × วันที่ พร้อม factor + ตันรวม
-- รันทั้งไฟล์นี้ใน Supabase (project yaxgqcopshhukofmmgla) → SQL Editor → Run
-- รันซ้ำได้ปลอดภัย (create or replace). เป็น VIEW เพิ่มใหม่ — ไม่แก้/ลบตารางเดิม.
-- =============================================================================
-- 1 แถว = (วันที่ + รุ่นรถ) หนึ่งคู่ พร้อม:
--   total_trips     = ผลรวม production_entries.trips
--   factor          = ตัน/เที่ยว ของสัปดาห์นั้น (carry-forward เหมือนแดชบอร์ด)
--   tonnes_total    = total_trips × factor  ← ตัวเลขที่แดชบอร์ดแสดง
--   tonnes_stored   = ผลรวม production_entries.tonnes (ค่าตอนกรอก) ไว้เทียบ
--
-- factor: หยิบ truck_model_factors ของสัปดาห์ที่ใช้ได้ล่าสุด (สัปดาห์เริ่มวันเสาร์
-- แบบเดียวกับ weekStartOf ในแอป). ถ้าไม่มี → fallback เป็น capacity_tonnes แล้ว
-- 43.7 (= DEFAULT_TONNES_PER_TRIP) ให้ตรงกับ factorFor() ทุกกรณี.
-- =============================================================================

create or replace view public.vw_production_by_model_day as
with rows as (
  select
    s.shift_date,
    tm.code    as model,
    tm.company as company,
    pe.trips,
    pe.tonnes,
    coalesce(
      (select tmf.factor
         from public.truck_model_factors tmf
        where tmf.truck_model_id = pe.truck_model_id
          -- วันเสาร์ต้นสัปดาห์ของ shift_date (สัปดาห์รันเสาร์–ศุกร์)
          and tmf.week_start <= (s.shift_date - ((extract(dow from s.shift_date)::int + 1) % 7))::date
        order by tmf.week_start desc
        limit 1),
      nullif(tm.capacity_tonnes, 0),
      43.7
    ) as factor
  from public.production_entries pe
  join public.truck_models tm on tm.id = pe.truck_model_id
  join public.shifts s        on s.id  = pe.shift_id
)
select
  shift_date,
  model,
  company,
  sum(trips)                     as total_trips,
  factor,
  round(sum(trips) * factor, 2)  as tonnes_total,
  round(sum(tonnes), 2)          as tonnes_stored
from rows
group by shift_date, model, company, factor
order by shift_date desc, total_trips desc;

-- แอปใช้ anon/publishable key → ต้องให้สิทธิ์อ่าน view นี้ (ตารางใต้ view เปิด anon อยู่แล้ว)
grant select on public.vw_production_by_model_day to anon, authenticated;

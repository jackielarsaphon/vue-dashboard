<script setup>
import { computed } from "vue";
import { useEntryStore, isWaste, rowTonnes } from "../../composables/useEntryStore.js";
import { usePlanProduction } from "../../composables/usePlanProduction.js";

// Per-pit shift report for one date. Reads the shared entry/plan caches (both
// module-level singletons), so whichever page loads them keeps this live.
const props = defineProps({
  date: { type: String, required: true },
});

const { getBucket } = useEntryStore();
const { getDatePlans } = usePlanProduction();

// Whole-tonne formatter for the report (tonnes carry decimals; the printed sheet
// shows integers).
const fmt0 = (n) => Math.round(Number(n) || 0).toLocaleString("en-US");

// ── Production report ─────────────────────────────────────────────────────────
// A per-pit shift report for the selected date, mirroring the printed sheet: Day
// and Night each split into Waste (soil) + Ore, then Total DS / Total NS, the pit's
// daily Total, its Plan Production target and the % variance to plan. Tonnes
// throughout — the same figures the KPI cards and the Plan column already use.
//
// Priority: use the value hand-set on the Plan Production step when present. When a
// pit has no priority entered, fall back to a derived band from how far it's running
// behind plan (achievement = Total ÷ Plan) — 1 (red, worst) … 4 (green, on plan) —
// so the colour still flags where attention is needed.
const reportPriority = (achievement) => (achievement < 50 ? 1 : achievement < 75 ? 2 : achievement < 90 ? 3 : 4);

const productionReport = computed(() => {
  const plans = getDatePlans(props.date);
  const byPit = new Map();
  const ensure = (code) => {
    if (!byPit.has(code)) byPit.set(code, { pit: code, day: { waste: 0, ore: 0 }, night: { waste: 0, ore: 0 }, plan: 0, planPriority: null });
    return byPit.get(code);
  };
  // Seed every planned pit so one with a plan but no trips still shows (as behind).
  Object.entries(plans).forEach(([code, p]) => {
    const stat = ensure(code);
    stat.plan = (Number(p.soil) || 0) + (Number(p.ore) || 0);
    stat.planPriority = p.priority == null ? null : Number(p.priority);
  });
  // Sum actual tonnes over all 24 hours of each shift, split Waste vs Ore per pit.
  [["Day", "day"], ["Night", "night"]].forEach(([shiftType, key]) => {
    for (let hour = 0; hour < 24; hour += 1) {
      Object.values(getBucket(props.date, shiftType, hour)).forEach((entry) => {
        if (!entry.area) return;
        const stat = ensure(entry.area);
        entry.rows.forEach((row) => {
          const tonnes = rowTonnes(row);
          if (isWaste(row.material)) stat[key].waste += tonnes;
          else stat[key].ore += tonnes;
        });
      });
    }
  });
  return Array.from(byPit.values())
    .map((r) => {
      const dayTotal = r.day.waste + r.day.ore;
      const nightTotal = r.night.waste + r.night.ore;
      const total = dayTotal + nightTotal;
      const variance = r.plan > 0 ? Math.round(((total - r.plan) / r.plan) * 100) : null;
      const achievement = r.plan > 0 ? (total / r.plan) * 100 : 100;
      const priority = r.planPriority != null ? r.planPriority : reportPriority(achievement);
      return { ...r, dayTotal, nightTotal, total, variance, priority };
    })
    // Ordered by Priority (1 = most behind, first) so the number column reads in
    // order; pit code breaks ties so same-priority pits keep a stable sequence.
    .sort((a, b) => a.priority - b.priority || a.pit.localeCompare(b.pit));
});

const reportTotals = computed(() => {
  const acc = { dayWaste: 0, dayOre: 0, dayTotal: 0, nightWaste: 0, nightOre: 0, nightTotal: 0, total: 0, plan: 0 };
  productionReport.value.forEach((r) => {
    acc.dayWaste += r.day.waste;
    acc.dayOre += r.day.ore;
    acc.dayTotal += r.dayTotal;
    acc.nightWaste += r.night.waste;
    acc.nightOre += r.night.ore;
    acc.nightTotal += r.nightTotal;
    acc.total += r.total;
    acc.plan += r.plan;
  });
  acc.variance = acc.plan > 0 ? Math.round(((acc.total - acc.plan) / acc.plan) * 100) : null;
  return acc;
});
</script>

<template>
  <section class="panel report-panel">
    <div class="panel-head">
      <h2>Production report</h2>
      <span class="now-pill mono">{{ date }}</span>
    </div>
    <div class="table-wrap">
      <table class="data tight report-table">
        <thead>
          <tr>
            <th rowspan="2">Priority</th>
            <th rowspan="2">Pit</th>
            <th colspan="3" class="grp grp-day">Day</th>
            <th colspan="3" class="grp grp-night">Night</th>
            <th rowspan="2" class="num">Total</th>
            <th rowspan="2" class="num">Plan</th>
            <th rowspan="2" class="num">% Variance</th>
          </tr>
          <tr>
            <th class="num col-day">Waste</th>
            <th class="num col-day">Ore</th>
            <th class="num col-day">Total DS</th>
            <th class="num col-night">Waste</th>
            <th class="num col-night">Ore</th>
            <th class="num col-night">Total NS</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in productionReport" :key="r.pit">
            <td class="prio-cell" :class="`prio-${r.priority}`">{{ r.priority }}</td>
            <td class="exc">{{ r.pit }}</td>
            <td class="num mono col-day">{{ fmt0(r.day.waste) }}</td>
            <td class="num mono col-day">{{ fmt0(r.day.ore) }}</td>
            <td class="num mono strong col-day">{{ fmt0(r.dayTotal) }}</td>
            <td class="num mono col-night">{{ fmt0(r.night.waste) }}</td>
            <td class="num mono col-night">{{ fmt0(r.night.ore) }}</td>
            <td class="num mono strong col-night">{{ fmt0(r.nightTotal) }}</td>
            <td class="num mono strong report-total">{{ fmt0(r.total) }}</td>
            <td class="num mono">{{ fmt0(r.plan) }}</td>
            <td class="num mono report-var" :class="r.variance == null ? '' : r.variance < 0 ? 'neg' : 'pos'">
              {{ r.variance == null ? "–" : `${r.variance}%` }}
            </td>
          </tr>
          <tr v-if="!productionReport.length" class="report-empty">
            <td colspan="11">No production or plan for this date.</td>
          </tr>
        </tbody>
        <tfoot v-if="productionReport.length">
          <tr>
            <td />
            <td>Total</td>
            <td class="num col-day">{{ fmt0(reportTotals.dayWaste) }}</td>
            <td class="num col-day">{{ fmt0(reportTotals.dayOre) }}</td>
            <td class="num strong col-day">{{ fmt0(reportTotals.dayTotal) }}</td>
            <td class="num col-night">{{ fmt0(reportTotals.nightWaste) }}</td>
            <td class="num col-night">{{ fmt0(reportTotals.nightOre) }}</td>
            <td class="num strong col-night">{{ fmt0(reportTotals.nightTotal) }}</td>
            <td class="num strong report-total">{{ fmt0(reportTotals.total) }}</td>
            <td class="num">{{ fmt0(reportTotals.plan) }}</td>
            <td class="num report-var" :class="reportTotals.variance == null ? '' : reportTotals.variance < 0 ? 'neg' : 'pos'">
              {{ reportTotals.variance == null ? "–" : `${reportTotals.variance}%` }}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  </section>
</template>

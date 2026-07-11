<script setup>
import { watchEffect, computed } from "vue";
import { useTweaks } from "../composables/useTweaks.js";
import { useShiftSelection } from "../composables/useShiftSelection.js";
import { useEntryStore } from "../composables/useEntryStore.js";
import { usePlanProduction } from "../composables/usePlanProduction.js";
import { useLiveRefresh } from "../composables/useLiveRefresh.js";
import { useDownloadImage } from "../composables/useDownloadImage.js";
import { useExcelExport } from "../composables/useExcelExport.js";
import TopBar from "../components/common/TopBar.vue";
import DownloadImageButton from "../components/common/DownloadImageButton.vue";
import ExcelExportButton from "../components/common/ExcelExportButton.vue";
import ProductionReport from "../components/common/ProductionReport.vue";
import ProductionShiftArea from "../components/common/ProductionShiftArea.vue";
import TweaksPanel from "../components/common/TweaksPanel.vue";
import TweakSection from "../components/common/TweakSection.vue";
import TweakRadio from "../components/common/TweakRadio.vue";
import TweakColor from "../components/common/TweakColor.vue";

const [t, setTweak] = useTweaks({
  accent: "#d99a00",
  density: "compact",
  theme: "light",
});

watchEffect(() => {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = t.theme;
  document.documentElement.dataset.density = t.density;
  document.documentElement.style.setProperty("--accent", t.accent);
});

const { selection } = useShiftSelection();

// Date/Time ticket for the page (and its PNG export). The top-bar clock is now
// excluded from the capture, so restate the selected date and hour here — same
// stacked format as the Fleet overview clock card ("6 Jul" / "17:00-18:00").
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const clockDate = computed(() => {
  const [y, m, d] = String(selection.date).split("-");
  const month = MONTHS[Number(m) - 1];
  return d && month && y ? `${Number(d)} ${month}` : "";
});
// Cumulative range from the shift start (06 Day / 18 Night) up to the selected
// hour — matches the top-bar HOUR dropdown and the running-total metrics.
const clockHour = computed(() => {
  const a = String(selection.shiftType === "Day" ? 6 : 18).padStart(2, "0");
  const b = String(selection.hour).padStart(2, "0");
  return `${a}:00-${b}:00`;
});

const { reload: reloadEntries } = useEntryStore();
const { reloadPlans } = usePlanProduction();

// Pick up production entered on another device (e.g. a phone) without a manual
// reload: re-fetch on tab focus / visibility and every 30s.
useLiveRefresh([reloadEntries, reloadPlans]);

// Download the whole Area production page as one PNG (shared logic).
const { dashRef, downloading, downloadImage } = useDownloadImage(() => `area-production-${selection.date}.png`);

// Export the same date's production as an Excel pivot (area × model × shift trips).
const { exporting, exportExcel } = useExcelExport();

</script>

<template>
  <div ref="dashRef" class="dash">
    <TopBar subtitle="Daily" />

    <DownloadImageButton :downloading="downloading" @click="downloadImage">
      <ExcelExportButton :busy="exporting" @click="exportExcel" />
    </DownloadImageButton>

    <!-- Date / Shift / Time ticket — mirrors the Fleet overview clock card so the
         exported PNG keeps its date & time context. -->
    <section class="kpi-strip area-kpi">
      <div class="kpi kpi-unified">
        <div class="kpi-cell kpi-cell-clock">
          <span class="kpi-cell-date">{{ clockDate }}</span>
          <span class="kpi-cell-hour mono">{{ clockHour }}</span>
        </div>
      </div>
    </section>

    <ProductionReport :date="selection.date" />

    <ProductionShiftArea />

    <TweaksPanel>
      <TweakSection label="Theme" />
      <TweakRadio label="Mode" :value="t.theme" :options="['dark', 'light']" @change="setTweak('theme', $event)" />
      <TweakColor label="Accent" :value="t.accent" :options="['#d99a00', '#22d3ee', '#a3e635', '#f472b6', '#fb7185']" @change="setTweak('accent', $event)" />
      <TweakSection label="Layout" />
      <TweakRadio label="Density" :value="t.density" :options="['compact', 'regular']" @change="setTweak('density', $event)" />
    </TweaksPanel>
  </div>
</template>

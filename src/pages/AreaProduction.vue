<script setup>
import { watchEffect, computed, ref, onMounted, onUnmounted } from "vue";
import { useTweaks } from "../composables/useTweaks.js";
import { useShiftSelection } from "../composables/useShiftSelection.js";
import { useEntryStore } from "../composables/useEntryStore.js";
import { usePlanProduction } from "../composables/usePlanProduction.js";
import { useLiveRefresh } from "../composables/useLiveRefresh.js";
import { useDownloadImage } from "../composables/useDownloadImage.js";
import TopBar from "../components/common/TopBar.vue";
import DownloadImageButton from "../components/common/DownloadImageButton.vue";
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
// excluded from the capture, so restate the report date and the live time here.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const now = ref(new Date());
let clockTimer = 0;
onMounted(() => {
  clockTimer = window.setInterval(() => { now.value = new Date(); }, 1000);
});
onUnmounted(() => window.clearInterval(clockTimer));
const clockDate = computed(() => {
  const [y, m, d] = String(selection.date).split("-");
  const month = MONTHS[Number(m) - 1];
  return d && month && y ? `${Number(d)} ${month} ${y}` : "";
});
const clockTime = computed(() => now.value.toLocaleTimeString("en-GB"));

const { reload: reloadEntries } = useEntryStore();
const { reloadPlans } = usePlanProduction();

// Pick up production entered on another device (e.g. a phone) without a manual
// reload: re-fetch on tab focus / visibility and every 30s.
useLiveRefresh([reloadEntries, reloadPlans]);

// Download the whole Area production page as one PNG (shared logic).
const { dashRef, downloading, downloadImage } = useDownloadImage(() => `area-production-${selection.date}.png`);

</script>

<template>
  <div ref="dashRef" class="dash">
    <TopBar subtitle="Daily" />

    <DownloadImageButton :downloading="downloading" @click="downloadImage" />

    <!-- Date / Shift / Time ticket — mirrors the Fleet overview clock card so the
         exported PNG keeps its date & time context. -->
    <section class="kpi-strip area-kpi">
      <div class="kpi kpi-unified">
        <div class="kpi-cell kpi-cell-clock">
          <span class="kpi-cell-date">{{ clockDate }}</span>
          <span class="kpi-cell-hour mono">{{ clockTime }}</span>
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

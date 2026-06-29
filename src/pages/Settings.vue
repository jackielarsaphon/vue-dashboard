<script setup>
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import TopBar from "../components/common/TopBar.vue";
import MiningArea from "./MiningArea.vue";
import MaterialRoutes from "./MaterialRoutes.vue";
import Excavator from "./Excavator.vue";
import DumpModel from "./DumpModel.vue";
import DumpLocation from "./DumpLocation.vue";

// Settings groups the master-data pages behind one nav button. Each page is
// rendered embedded (without its own TopBar / full-page shell) under the tab bar.
// (Users / employee logins now live on their own "Manager" page, not here.)
const tabs = [
  { key: "mining", label: "Mining data", comp: MiningArea },
  { key: "routes", label: "Material routes", comp: MaterialRoutes },
  { key: "excavator", label: "Excavator", comp: Excavator },
  { key: "dumpmodel", label: "Dump model", comp: DumpModel },
  { key: "location", label: "Locations", comp: DumpLocation },
];

const route = useRoute();
const router = useRouter();
const keys = tabs.map((t) => t.key);

const active = ref(keys.includes(route.query.tab) ? route.query.tab : "mining");
const activeComp = computed(() => (tabs.find((t) => t.key === active.value) || tabs[0]).comp);

// Keep the chosen tab in the URL (?tab=) so a refresh / deep link reopens it.
watch(active, (value) => router.replace({ query: { ...route.query, tab: value } }));
</script>

<template>
  <div class="entry-dash settings-page">
    <TopBar subtitle="Settings" />

    <nav class="settings-tabs" aria-label="Settings sections">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        type="button"
        :class="{ on: active === tab.key }"
        @click="active = tab.key"
      >
        {{ tab.label }}
      </button>
    </nav>

    <component :is="activeComp" embedded />
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref, watchEffect } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuth } from "../../composables/useAuth.js";
import { useShiftSelection } from "../../composables/useShiftSelection.js";

const { user, logout } = useAuth();
const userInitial = computed(() => (user.value?.name || user.value?.username || "?").trim().charAt(0).toUpperCase());
const isAdmin = computed(() => user.value?.role === "admin");
const { selection, setDate, setShiftType, setHour } = useShiftSelection();

defineProps({
  subtitle: { type: String, default: "Live" },
});

const route = useRoute();
const router = useRouter();

const handleLogout = () => {
  logout();
  router.push("/login");
};

const now = ref(new Date());
const userAdjustedTime = ref(false);
let timerId = 0;

onMounted(() => {
  timerId = window.setInterval(() => {
    now.value = new Date();
  }, 1000);
});

onUnmounted(() => {
  window.clearInterval(timerId);
});

const clock = computed(() => now.value.toLocaleTimeString("en-GB"));
const autoHour = computed(() => now.value.getHours());
const autoShiftType = computed(() => (autoHour.value >= 6 && autoHour.value < 19 ? "Day" : "Night"));

// Data entry follows the clock: the current date/hour is the latest you can
// key, future slots are blocked, but any past slot stays editable.
const toIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const nowIso = computed(() => toIso(now.value));

// The real wall-clock start of a (date, shift, hour) slot. Night-shift hours
// 0-5 happen on the morning after the shift date, so they map to date + 1.
const slotStart = (date, shiftType, hour) => {
  const base = new Date(`${date}T00:00:00`);
  if (shiftType === "Night" && hour <= 5) base.setDate(base.getDate() + 1);
  base.setHours(hour, 0, 0, 0);
  return base;
};
const isFutureSlot = (date, shiftType, hour) => slotStart(date, shiftType, hour).getTime() > now.value.getTime();
const allowedHours = (date, shiftType) => {
  const values = shiftType === "Day" ? [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18] : [19, 20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
  return values.filter((hour) => !isFutureSlot(date, shiftType, hour));
};

// The production shift_date for the current clock time. Night-shift hours 0-5
// belong to the shift that started the previous evening, so before 06:00 the
// active shift_date is yesterday — not today.
const autoShiftDate = computed(() => {
  if (autoHour.value <= 5) {
    const d = new Date(now.value);
    d.setDate(d.getDate() - 1);
    return toIso(d);
  }
  return nowIso.value;
});

// selection.date is yyyy-mm-dd; display uses dd/mm/yyyy.
const toDisplay = (iso) => {
  const [y, m, d] = String(iso).split("-");
  return d && m && y ? `${d}/${m}/${y}` : "";
};

const dateDisplay = computed(() => toDisplay(selection.date));
const dateInput = ref(null);

const openDatePicker = () => {
  const el = dateInput.value;
  if (!el) return;
  if (typeof el.showPicker === "function") el.showPicker();
  else el.focus();
};

const onDateChange = (event) => {
  const value = event.target.value;
  if (!value || value > nowIso.value) return; // no future dates
  userAdjustedTime.value = true; // manual pick — stop auto-snapping back to "now"
  setDate(value);
};

const hours = computed(() =>
  allowedHours(selection.date, selection.shiftType).map((hour) => {
    const a = String(hour).padStart(2, "0");
    const b = String((hour + 1) % 24).padStart(2, "0");
    return { value: hour, label: `${a}:00 - ${b}:00` };
  }),
);

watchEffect(() => {
  if (userAdjustedTime.value) return;
  if (selection.date !== autoShiftDate.value) setDate(autoShiftDate.value);
  if (selection.shiftType !== autoShiftType.value) setShiftType(autoShiftType.value);
  if (selection.hour !== autoHour.value) setHour(autoHour.value);
});

// Keep the saved/active selection from ever sitting in the future (e.g. clock
// ticking past, or a stale localStorage selection): clamp date then hour back.
watchEffect(() => {
  if (selection.date > nowIso.value) {
    setDate(nowIso.value);
    return;
  }
  if (isFutureSlot(selection.date, selection.shiftType, selection.hour)) {
    const allowed = allowedHours(selection.date, selection.shiftType);
    if (allowed.length) setHour(allowed[allowed.length - 1]);
  }
});

const toggleShift = () => {
  userAdjustedTime.value = true;
  const nextShift = selection.shiftType === "Night" ? "Day" : "Night";
  const allowed = allowedHours(selection.date, nextShift);
  if (allowed.length === 0) return; // the whole shift is still in the future — block
  setShiftType(nextShift);
  if (!allowed.includes(selection.hour)) setHour(allowed[allowed.length - 1]);
};

const onHourChange = (event) => {
  userAdjustedTime.value = true;
  const hour = Number(event.target.value);
  if (isFutureSlot(selection.date, selection.shiftType, hour)) return;
  setHour(hour);
};
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <div class="brand-mark">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <path d="M3 18 L9 8 L13 14 L17 6 L21 18 Z" fill="currentColor" opacity=".9" />
          <path d="M3 20 L21 20" stroke="currentColor" stroke-width="1.5" />
        </svg>
      </div>
      <div>
        <div class="brand-title">PRODUCTION CONTROL</div>
        <div class="brand-sub">Loading &amp; Hauling - {{ subtitle }}</div>
      </div>
    </div>

    <nav class="topnav" aria-label="Dashboard pages">
      <router-link to="/fleet" custom v-slot="{ navigate }">
        <button :class="{ on: route.name === 'fleet' }" type="button" @click="navigate">Fleet overview</button>
      </router-link>
      <router-link to="/area" custom v-slot="{ navigate }">
        <button :class="{ on: route.name === 'area' }" type="button" @click="navigate">Area production</button>
      </router-link>
      <router-link v-if="isAdmin" to="/entry" custom v-slot="{ navigate }">
        <button :class="{ on: route.name === 'entry' }" type="button" @click="navigate">Data entry</button>
      </router-link>
      <router-link v-if="isAdmin" to="/mining" custom v-slot="{ navigate }">
        <button :class="{ on: route.name === 'mining' }" type="button" @click="navigate">Mining data</button>
      </router-link>
      <router-link v-if="isAdmin" to="/material-routes" custom v-slot="{ navigate }">
        <button :class="{ on: route.name === 'materialroutes' }" type="button" @click="navigate">Material routes</button>
      </router-link>
      <router-link v-if="isAdmin" to="/excavator" custom v-slot="{ navigate }">
        <button :class="{ on: route.name === 'excavator' }" type="button" @click="navigate">Excavator</button>
      </router-link>
      <router-link v-if="isAdmin" to="/dumpmodel" custom v-slot="{ navigate }">
        <button :class="{ on: route.name === 'dumpmodel' }" type="button" @click="navigate">Dump model</button>
      </router-link>
      <router-link v-if="isAdmin" to="/location" custom v-slot="{ navigate }">
        <button :class="{ on: route.name === 'location' }" type="button" @click="navigate">Locations</button>
      </router-link>
      <router-link v-if="isAdmin" to="/users" custom v-slot="{ navigate }">
        <button :class="{ on: route.name === 'users' }" type="button" @click="navigate">Users</button>
      </router-link>
    </nav>

    <div class="topbar-meta">
      <div class="meta">
        <span class="meta-k">DATE</span>
        <div class="date-field">
          <button class="meta-v date-btn" type="button" @click="openDatePicker">{{ dateDisplay }}</button>
          <input ref="dateInput" class="date-hidden" type="date" :value="selection.date" :max="nowIso" @change="onDateChange" />
        </div>
      </div>
      <div class="meta">
        <span class="meta-k">SHIFT</span>
        <button class="meta-v shift-btn" type="button" title="Click to change shift" @click="toggleShift">{{ selection.shiftType }}</button>
      </div>
      <div class="meta">
        <span class="meta-k">HOUR</span>
        <select class="meta-select" :value="selection.hour" title="Change hour" @change="onHourChange">
          <option v-for="hour in hours" :key="hour.value" :value="hour.value">{{ hour.label }}</option>
        </select>
      </div>
      <div class="meta clock">
        <span class="pulse" />
        <span class="meta-v mono">{{ clock }}</span>
      </div>
      <div v-if="user" class="user-box">
        <span class="user-avatar">{{ userInitial }}</span>
        <div class="user-info">
          <span class="user-name">{{ user.name || user.username }}</span>
          <span class="user-role">{{ user.role }}</span>
        </div>
        <button class="user-logout" type="button" title="Sign out" aria-label="Sign out" @click="handleLogout">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path
              d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  </header>
</template>

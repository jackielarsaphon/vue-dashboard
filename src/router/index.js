import { createRouter, createWebHashHistory } from "vue-router";
import { useAuth } from "../composables/useAuth.js";
import { isMobileViewport } from "../composables/useIsMobile.js";
import Login from "../pages/Login.vue";
import FleetOverview from "../pages/FleetOverview.vue";
import AreaProduction from "../pages/AreaProduction.vue";
import DataEntry from "../pages/DataEntry.vue";
import Settings from "../pages/Settings.vue";

// Hash history (not server history) since this app is mounted as a widget via
// mountProductionDashboard(), not necessarily served with SPA fallback routing.
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/fleet" },
    { path: "/login", name: "login", component: Login, meta: { public: true } },
    { path: "/fleet", name: "fleet", component: FleetOverview },
    { path: "/area", name: "area", component: AreaProduction },
    { path: "/entry", name: "entry", component: DataEntry, meta: { adminOnly: true } },
    { path: "/settings", name: "settings", component: Settings, meta: { adminOnly: true } },
    // Old per-page links now live as tabs under Settings — keep them working.
    { path: "/mining", redirect: "/settings?tab=mining" },
    { path: "/material-routes", redirect: "/settings?tab=routes" },
    { path: "/excavator", redirect: "/settings?tab=excavator" },
    { path: "/dumpmodel", redirect: "/settings?tab=dumpmodel" },
    { path: "/location", redirect: "/settings?tab=location" },
    { path: "/users", redirect: "/settings?tab=users" },
    { path: "/:pathMatch(.*)*", redirect: "/fleet" },
  ],
});

router.beforeEach((to) => {
  const { user } = useAuth();
  const isAdmin = user.value?.role === "admin";

  if (to.meta.public) {
    if (user.value) return { path: "/fleet" };
    return true;
  }

  if (!user.value) return { path: "/login" };
  if (to.meta.adminOnly && !isAdmin) return { path: "/fleet" };

  // On phones the app is a data-entry-only kiosk for admins: every other page
  // redirects to Data entry. (Non-admins keep their normal pages — they can't
  // open Data entry anyway.)
  if (isMobileViewport() && isAdmin && to.name !== "entry") return { name: "entry" };
  return true;
});

export default router;

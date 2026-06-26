import { createRouter, createWebHashHistory } from "vue-router";
import { useAuth } from "../composables/useAuth.js";
import Login from "../pages/Login.vue";
import FleetOverview from "../pages/FleetOverview.vue";
import AreaProduction from "../pages/AreaProduction.vue";
import DataEntry from "../pages/DataEntry.vue";
import MiningArea from "../pages/MiningArea.vue";
import MaterialRoutes from "../pages/MaterialRoutes.vue";
import Excavator from "../pages/Excavator.vue";
import DumpModel from "../pages/DumpModel.vue";
import DumpLocation from "../pages/DumpLocation.vue";
import Users from "../pages/Users.vue";

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
    { path: "/mining", name: "mining", component: MiningArea, meta: { adminOnly: true } },
    { path: "/material-routes", name: "materialroutes", component: MaterialRoutes, meta: { adminOnly: true } },
    { path: "/excavator", name: "excavator", component: Excavator, meta: { adminOnly: true } },
    { path: "/dumpmodel", name: "dumpmodel", component: DumpModel, meta: { adminOnly: true } },
    { path: "/location", name: "location", component: DumpLocation, meta: { adminOnly: true } },
    { path: "/users", name: "users", component: Users, meta: { adminOnly: true } },
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
  return true;
});

export default router;

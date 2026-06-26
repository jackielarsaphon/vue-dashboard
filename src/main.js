import { createApp } from "vue";
import App from "./App.vue";
import router from "./router/index.js";
import "./styles/base.css";
import "./styles/entry.css";
import "./styles/area.css";

export function mountProductionDashboard(target = "#app") {
  return createApp(App).use(router).mount(target);
}

if (typeof document !== "undefined") {
  const target = document.querySelector("#app");
  if (target) mountProductionDashboard(target);
}

export { App };

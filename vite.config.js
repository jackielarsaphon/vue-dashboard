import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Two build targets share this config:
//   vite build              -> standalone app for GitHub Pages (base = /vue-dashboard/)
//   vite build --mode lib   -> embeddable library (mountProductionDashboard widget)
// Dev/preview keep base "/" so http://localhost:5175/ works directly.
export default defineConfig(({ command, mode }) => {
  const isLib = mode === "lib";

  return {
    plugins: [vue()],
    base: command === "build" && !isLib ? "/vue-dashboard/" : "/",
    server: {
      port: 5175,
    },
    build: isLib
      ? {
          lib: {
            entry: "src/main.js",
            name: "ProductionDailyDashboard",
            fileName: "production-daily-dashboard",
          },
        }
      : {},
  };
});

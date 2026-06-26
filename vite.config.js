import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5174,
  },
  build: {
    lib: {
      entry: "src/main.js",
      name: "ProductionDailyDashboard",
      fileName: "production-daily-dashboard",
    },
  },
});

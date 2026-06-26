# Production Daily Dashboard - Vue

This folder is the Vue 3 conversion of the original dashboard code.

No HTML file is included here by request. The app is exported as Vue code and can be mounted from an existing Vue/Vite shell.

Main entry:

```js
import { mountProductionDashboard } from "./src/main.js";

mountProductionDashboard("#app");
```

Pages included:

- Fleet overview
- Area production
- Data entry

Build:

```bash
npm install
npm run build
```

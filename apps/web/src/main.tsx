import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";

import "@fontsource-variable/jetbrains-mono";
import "./index.css";

import { appHistory } from "./appNavigation";
import { getRouter } from "./router";
import { APP_DISPLAY_NAME } from "./branding";
import { isElectron } from "./env";
import { trackScrollActivity } from "./lib/scrollActivity";

const router = getRouter(appHistory);

document.title = APP_DISPLAY_NAME;
trackScrollActivity(document);

try {
  localStorage.removeItem("glade:kanban-ui:v1");
} catch {
  // Storage can be unavailable in restricted browser contexts.
}

if (isElectron) {
  document.documentElement.dataset.runtime = "electron";
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);

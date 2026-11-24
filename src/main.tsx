import "@fontsource/scheherazade-new/arabic-400.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./install";
import "./styles.css";
import { initTelegram } from "./telegram";

initTelegram();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base: "./" — чтобы сборка работала из любой папки (GitHub Pages, Vercel, свой сервер).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { host: true },
});

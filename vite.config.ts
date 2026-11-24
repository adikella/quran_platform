import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// base: "./" — чтобы сборка работала из любой папки (GitHub Pages, Vercel, свой сервер).
export default defineConfig({
  base: "./",
  plugins: [react()],
  // allowedHosts: временная ссылка cloudflared для проверки с телефона.
  server: {
    host: true,
    allowedHosts: [".trycloudflare.com"],
    // Распознавание чтения работает на сервере: в разработке ходим туда же.
    // Аккаунты в разработке можно направить на свой сервер: API_TARGET=http://127.0.0.1:8091 npm run dev
    proxy: {
      "/api/asr": { target: "https://130-61-147-45.sslip.io", changeOrigin: true },
      "/api": { target: process.env.API_TARGET ?? "https://130-61-147-45.sslip.io", changeOrigin: true },
    },
  },
});

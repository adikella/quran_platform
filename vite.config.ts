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
    proxy: { "/api": { target: "https://130-61-147-45.sslip.io", changeOrigin: true } },
  },
});

// Значок приложения на экране телефона или компьютера.
import { useEffect, useState } from "react";
import { inTelegram, tg } from "./telegram";

/** Событие Chrome и Edge: браузер готов предложить установку. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  listeners.forEach((l) => l());
});
window.addEventListener("appinstalled", () => {
  deferred = null;
  listeners.forEach((l) => l());
});

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/**
 * Как ставить значок здесь:
 * telegram: кнопка самого Telegram (данные те же); telegram-desktop: только через браузер;
 * prompt: браузер ставит по кнопке; ios, mac-safari, manual: по инструкции; done: уже открыто со значка.
 */
export type InstallWay = "telegram" | "telegram-desktop" | "prompt" | "ios" | "mac-safari" | "manual" | "done";

function way(): InstallWay {
  if (inTelegram) {
    const mobile = /^(ios|android|android_x)$/.test(tg?.platform ?? "");
    return mobile && tg?.addToHomeScreen && tg.isVersionAtLeast?.("8.0") ? "telegram" : "telegram-desktop";
  }
  if (standalone()) return "done";
  if (deferred) return "prompt";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "ios";
  if (/Macintosh/.test(ua) && /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua)) return "mac-safari";
  return "manual";
}

export function useInstallWay(): InstallWay {
  const [w, setW] = useState(way);
  useEffect(() => {
    const update = () => setW(way());
    listeners.add(update);
    update();
    return () => void listeners.delete(update);
  }, []);
  return w;
}

export async function promptInstall() {
  const e = deferred;
  if (!e) return;
  await e.prompt();
  await e.userChoice;
  // Одно событие можно показать один раз.
  deferred = null;
  listeners.forEach((l) => l());
}

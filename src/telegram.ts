// Обёртка над Telegram Mini App. Вне Telegram (на сайте) всё работает так же, просто без этих функций.

type TgWebApp = {
  ready(): void;
  expand(): void;
  HapticFeedback?: { impactOccurred(style: "light" | "medium" | "heavy"): void; notificationOccurred(t: "success" | "error" | "warning"): void };
  disableVerticalSwipes?: () => void;
  colorScheme?: "light" | "dark";
};

export const tg: TgWebApp | undefined = (window as any).Telegram?.WebApp?.initData !== undefined
  ? (window as any).Telegram.WebApp
  : undefined;

export const inTelegram = Boolean((window as any).Telegram?.WebApp?.initData);

export function initTelegram() {
  if (!inTelegram || !tg) return;
  tg.ready();
  tg.expand();
  tg.disableVerticalSwipes?.();
  document.documentElement.classList.add("tg");
  if (tg.colorScheme) document.documentElement.dataset.theme = tg.colorScheme;
}

/** Тема, которую просит Telegram; вне Telegram undefined, и работает системная. */
export function telegramTheme(): "light" | "dark" | undefined {
  return inTelegram && tg?.colorScheme ? tg.colorScheme : undefined;
}

export function haptic(kind: "tap" | "success" | "error" = "tap") {
  const h = inTelegram ? tg?.HapticFeedback : undefined;
  if (h) {
    if (kind === "tap") h.impactOccurred("light");
    else h.notificationOccurred(kind);
  } else if (kind === "tap" && "vibrate" in navigator) {
    try {
      navigator.vibrate(8);
    } catch {
      /* вибрация недоступна */
    }
  }
}

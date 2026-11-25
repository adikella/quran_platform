import { useT } from "../hooks";
import type { Lang } from "../types";

/** «Сегодня», «Завтра», дальше день недели и число. */
export function DateLine({ shift, lang }: { shift: number; lang: Lang }) {
  const t = useT();
  if (shift === 0) return <>{t("cab_today")}</>;
  if (shift === 1) return <>{t("manzilNext")}</>;
  const d = new Date();
  d.setDate(d.getDate() + shift);
  return <>{d.toLocaleDateString(lang === "kk" ? "kk-KZ" : lang, { weekday: "short", day: "numeric", month: "short" })}</>;
}

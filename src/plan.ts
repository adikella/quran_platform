// План повторения на сегодня: его считает приложение ученика и отдаёт серверу.
// По нему бот напоминает утром, а напарник видит, что принять рядом.

import { translate } from "./i18n";
import { revision } from "./method";
import { rangesText, unitText, type T } from "./ranges";
import type { Lang, LineRange, MushafMeta, Student } from "./types";

export interface PlanItem {
  text: string;
  ranges: LineRange[];
  groups?: number;
}

export interface Plan {
  head: string;
  sabki: PlanItem | null;
  manzil: PlanItem | null;
  /** Когда последний раз сдано. */
  done: { sabki?: string; manzil?: string };
  at: string;
  tz: string;
}

export function makePlan(s: Student, meta: MushafMeta, lang: Lang, tz: string): Plan {
  const t: T = (k, v) => translate(lang, k, v);
  const rev = s.stage === "hifz" ? revision(s, meta) : null;
  const last = (kind: "sabki" | "manzil") => {
    const dates = s.submissions.filter((x) => x.kind === kind && x.passed).map((x) => x.date);
    return dates.length ? { [kind]: dates.sort().at(-1) } : {};
  };
  const cut = (text: string) => (text.length > 400 ? `${text.slice(0, 397)}...` : text);
  const lines = (p: number) => meta.page[p - 1][3];
  return {
    head: t("plan_head"),
    sabki: rev?.sabki.length ? { text: cut(`${t("col_sabki")}: ${rangesText(rev.sabki, lines, t)}`), ranges: rev.sabki.slice(0, 200) } : null,
    manzil: rev?.manzilToday.length
      ? {
          text: cut(`${t("col_manzil")}: ${rev.manzilToday.map((u) => unitText(u, t)).join("; ")}`),
          ranges: rev.manzilToday.flatMap((u) => u.ranges).slice(0, 200),
          groups: Math.min(30, rev.manzilToday.length),
        }
      : null,
    done: { ...last("sabki"), ...last("manzil") },
    at: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.method.remindAt) ? s.method.remindAt : "",
    tz,
  };
}

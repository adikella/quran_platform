// План повторения на сегодня: его считает приложение ученика и отдаёт серверу.
// По нему бот напоминает утром, а напарник видит, что принять рядом.

import { translate } from "./i18n";
import { revision, type ManzilUnit } from "./method";
import { compareVerse, surahName, versesOfRange } from "./mushaf";
import type { T } from "./ranges";
import type { Lang, LineRange, MushafMeta, PageData, Student, Surah } from "./types";

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

/** Что нужно, чтобы назвать аяты: суры и страницы, где отрывок начинается или кончается посреди страницы. */
export interface Names {
  surahs: Surah[];
  pages: Map<number, PageData>;
}

/** Страницы, которые надо загрузить для `Names`: целые страницы называются по разметке. */
export function partialPages(ranges: LineRange[], meta: MushafMeta): number[] {
  return [...new Set(ranges.filter((r) => r.from > 0 || r.to < meta.page[r.page - 1][3]).map((r) => r.page))];
}

/** Первый и последний аят отрывка. */
function versesOf(r: LineRange, meta: MushafMeta, pages: Map<number, PageData>): [string, string] | null {
  const [, first, last, lines] = meta.page[r.page - 1];
  if (r.from === 0 && r.to >= lines) return [first, last];
  const p = pages.get(r.page);
  return p ? versesOfRange(p, r.from, r.to) : null;
}

/** «Ан-Наба – Абаса; Аль-Адийат – Ан-Нас»: подряд идущие аяты сливаются, целая сура называется без номеров. */
export function versesText(ranges: LineRange[], meta: MushafMeta, names: Names, lang: Lang): string {
  const spans = ranges.map((r) => versesOf(r, meta, names.pages));
  if (!spans.length || spans.some((x) => !x)) return "";
  const sorted = (spans as [string, string][]).sort((a, b) => compareVerse(a[0], b[0]));
  const ayahs = (s: number) => names.surahs[s - 1]?.ayahs ?? 0;
  const after = (v: string) => {
    const [s, a] = v.split(":").map(Number);
    return a >= ayahs(s) ? `${s + 1}:1` : `${s}:${a + 1}`;
  };
  const runs: [string, string][] = [];
  for (const [a, b] of sorted) {
    const prev = runs[runs.length - 1];
    if (prev && compareVerse(a, after(prev[1])) <= 0) {
      if (compareVerse(b, prev[1]) > 0) prev[1] = b;
    } else runs.push([a, b]);
  }
  const name = (s: number) => surahName(names.surahs[s - 1], lang);
  return runs
    .map(([from, to]) => {
      const [sa, va] = from.split(":").map(Number);
      const [sb, vb] = to.split(":").map(Number);
      const whole = va === 1 && vb >= ayahs(sb);
      if (sa === sb) return whole ? name(sa) : va === vb ? `${name(sa)} ${va}` : `${name(sa)} ${va}–${vb}`;
      if (whole) return `${name(sa)} – ${name(sb)}`;
      if (va === 1) return `${name(sa)} – ${name(sb)} ${vb}`;
      return `${name(sa)} ${va} – ${name(sb)} ${vb}`;
    })
    .join("; ");
}

/** «стр. 582–586, 599–604». */
export function pagesText(ranges: LineRange[], t: T): string {
  const pages = [...new Set(ranges.map((r) => r.page))].sort((a, b) => a - b);
  const runs: [number, number][] = [];
  for (const p of pages) {
    const last = runs[runs.length - 1];
    if (last && p === last[1] + 1) last[1] = p;
    else runs.push([p, p]);
  }
  return t("plan_pages", { list: runs.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ") });
}

function unitLine(u: ManzilUnit, meta: MushafMeta, names: Names | undefined, lang: Lang, t: T) {
  const verses = names ? versesText(u.ranges, meta, names, lang) : "";
  return [`${t("juz")} ${u.juz}${verses ? `: ${verses}` : ""}`, pagesText(u.ranges, t)];
}

export function makePlan(s: Student, meta: MushafMeta, lang: Lang, tz: string, names?: Names): Plan {
  const t: T = (k, v) => translate(lang, k, v);
  const rev = s.stage === "hifz" ? revision(s, meta) : null;
  const last = (kind: "sabki" | "manzil") => {
    const dates = s.submissions.filter((x) => x.kind === kind && x.passed).map((x) => x.date);
    return dates.length ? { [kind]: dates.sort().at(-1) } : {};
  };
  const cut = (text: string) => (text.length > 400 ? `${text.slice(0, 397)}...` : text);
  const sabkiVerses = rev && names ? versesText(rev.sabki, meta, names, lang) : "";
  return {
    head: t("plan_head"),
    sabki: rev?.sabki.length
      ? {
          text: cut([t("col_sabki"), ...(sabkiVerses ? [sabkiVerses] : []), pagesText(rev.sabki, t)].join("\n")),
          ranges: rev.sabki.slice(0, 200),
        }
      : null,
    manzil: rev?.manzilToday.length
      ? {
          text: cut([t("col_manzil"), ...rev.manzilToday.flatMap((u) => unitLine(u, meta, names, lang, t))].join("\n")),
          ranges: rev.manzilToday.flatMap((u) => u.ranges).slice(0, 200),
          groups: Math.min(30, rev.manzilToday.length),
        }
      : null,
    done: { ...last("sabki"), ...last("manzil") },
    at: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.method.remindAt) ? s.method.remindAt : "",
    tz,
  };
}

// Загрузка страниц мусхафа и подписи вида «Аль-Бакара 142–146».

import type { Lang, LineRange, MushafId, MushafMeta, PageData, Surah } from "./types";

const BASE = import.meta.env.BASE_URL;

const metaCache = new Map<MushafId, Promise<MushafMeta>>();
const chunkCache = new Map<string, Promise<PageData[]>>();
let surahsPromise: Promise<Surah[]> | null = null;

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}data/${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

export function loadMeta(m: MushafId): Promise<MushafMeta> {
  let p = metaCache.get(m);
  if (!p) {
    p = getJson<MushafMeta>(`${m}/meta.json?v=3`);
    p.catch(() => metaCache.delete(m));
    metaCache.set(m, p);
  }
  return p;
}

export function loadSurahs(): Promise<Surah[]> {
  if (!surahsPromise) {
    surahsPromise = getJson<Surah[]>("surahs.json");
    surahsPromise.catch(() => (surahsPromise = null));
  }
  return surahsPromise;
}

export async function loadPage(m: MushafId, page: number): Promise<PageData> {
  const meta = await loadMeta(m);
  const c = Math.floor((page - 1) / meta.chunk);
  const key = `${m}/${c}`;
  let p = chunkCache.get(key);
  if (!p) {
    p = getJson<PageData[]>(`${m}/p${c}.json?v=3`);
    p.catch(() => chunkCache.delete(key));
    chunkCache.set(key, p);
  }
  const chunk = await p;
  return chunk[(page - 1) % meta.chunk];
}

/** Ключи первого и последнего аята в строках [from, to) страницы. */
export function versesOfRange(page: PageData, from: number, to: number): [string, string] {
  const lines = page.l.slice(from, to);
  if (!lines.length) return [page.v[0], page.v[0]];
  const first = page.v[lines[0].f];
  const last = lines[lines.length - 1];
  // Если строка кончается знаком конца аята, последний аят — тот, что закончился; иначе — текущий.
  let idx = last.f;
  last.w.forEach((w, i) => {
    if (typeof w === "number" && i < last.w.length - 1) idx++;
  });
  return [first, page.v[Math.min(idx, page.v.length - 1)]];
}

export async function versesOfRanges(m: MushafId, ranges: LineRange[]): Promise<[string, string]> {
  if (!ranges.length) return ["", ""];
  const pages = await Promise.all(ranges.map((r) => loadPage(m, r.page)));
  const spans = ranges.map((r, i) => versesOfRange(pages[i], r.from, r.to));
  const sorted = spans.flat().sort(compareVerse);
  return [sorted[0], sorted[sorted.length - 1]];
}

export function compareVerse(a: string, b: string): number {
  const [sa, va] = a.split(":").map(Number);
  const [sb, vb] = b.split(":").map(Number);
  return sa - sb || va - vb;
}

export function surahName(s: Surah | undefined, lang: Lang): string {
  if (!s) return "";
  return lang === "ar" ? s.ar : s.tr;
}

/** «Аль-Бакара 142–146» или «Аль-Бакара 280 — Аль-Имран 5». */
export function verseSpanLabel(from: string, to: string, surahs: Surah[], lang: Lang): string {
  if (!from) return "";
  const [sa, va] = from.split(":").map(Number);
  const [sb, vb] = to.split(":").map(Number);
  const na = surahName(surahs[sa - 1], lang);
  if (sa === sb) return va === vb ? `${na} ${va}` : `${na} ${va}–${vb}`;
  return `${na} ${va} – ${surahName(surahs[sb - 1], lang)} ${vb}`;
}

/** Арабские цифры для знака конца аята. */
export function arabicDigits(n: number): string {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
}

/** Суры, которые начинаются на этой странице, и перед какой строкой (индекс). */
export function surahStarts(page: PageData): { surah: number; beforeLine: number }[] {
  const out: { surah: number; beforeLine: number }[] = [];
  page.l.forEach((line, li) => {
    let vi = line.f;
    let atStart = true;
    for (const w of line.w) {
      const [s, a] = page.v[vi].split(":").map(Number);
      if (atStart && a === 1 && !out.some((o) => o.surah === s)) out.push({ surah: s, beforeLine: li });
      atStart = false;
      if (typeof w === "number") {
        vi = Math.min(vi + 1, page.v.length - 1);
        atStart = true;
      }
    }
  });
  return out;
}

/** Какие суры и аяты на странице: [{ surah, from, to }], по разметке мусхафа. */
export function pageSurahs(meta: MushafMeta, page: number, surahs: Surah[]): { surah: number; from: number; to: number }[] {
  const [, first, last] = meta.page[page - 1];
  const [sa, va] = first.split(":").map(Number);
  const [sb, vb] = last.split(":").map(Number);
  const out = [];
  for (let s = sa; s <= sb; s++) out.push({ surah: s, from: s === sa ? va : 1, to: s === sb ? vb : (surahs[s - 1]?.ayahs ?? 0) });
  return out;
}

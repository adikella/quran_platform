// Что выучено и в каком порядке учить дальше. Чистые функции, проверяются тестами.
//
// Выученное хранится по строкам: целые страницы в hifz.memorized, остальное в hifz.parts.
// Сура редко занимает страницу целиком, поэтому одних страниц мало.

import { nextLessonRange } from "./method";
import type { LineRange, MushafMeta, Student } from "./types";

export type Span = [number, number];
/** Страница и её выученные строки. */
export type Learned = Map<number, Span[]>;

export const linesOn = (meta: MushafMeta, p: number) => meta.page[p - 1][3];
export const juzOf = (meta: MushafMeta, p: number) => meta.page[p - 1][0];

/** Складывает отрезки: по порядку, без пересечений и стыков. */
export function joinSpans(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const [a, b] of [...spans].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Строки из [from, to), которых нет в отрезках. */
export function gaps(spans: Span[], from: number, to: number): Span[] {
  const out: Span[] = [];
  let a = from;
  for (const [x, y] of joinSpans(spans)) {
    if (y <= a) continue;
    if (x >= to) break;
    if (x > a) out.push([a, x]);
    a = Math.max(a, y);
  }
  if (a < to) out.push([a, to]);
  return out;
}

export const covers = (spans: Span[], from: number, to: number) => gaps(spans, from, to).length === 0;

export function learnedOf(h: Student["hifz"], meta: MushafMeta): Learned {
  const out: Learned = new Map();
  if (h.parts) for (const [p, spans] of Object.entries(h.parts)) out.set(Number(p), joinSpans(spans.map(([a, b]): Span => [a, b])));
  // Ученики, сохранённые раньше: на текущей странице выучено всё до строки cur.line.
  else if (h.cur.line > 0) out.set(h.cur.page, [[0, Math.min(h.cur.line, linesOn(meta, h.cur.page))]]);
  for (const p of h.memorized) out.set(p, [[0, linesOn(meta, p)]]);
  return out;
}

export function addRange(l: Learned, r: LineRange): Learned {
  return new Map(l).set(r.page, joinSpans([...(l.get(r.page) ?? []), [r.from, r.to]]));
}

export function removeRange(l: Learned, r: LineRange): Learned {
  const next = new Map(l);
  const rest = (l.get(r.page) ?? []).flatMap(([a, b]): Span[] => [
    [a, Math.min(b, r.from)],
    [Math.max(a, r.to), b],
  ]);
  const spans = joinSpans(rest);
  if (spans.length) next.set(r.page, spans);
  else next.delete(r.page);
  return next;
}

/** Выучены ли отрезки: целиком, частью или нет. */
export function coverage(l: Learned, ranges: LineRange[]): "full" | "part" | "none" {
  const done = ranges.filter((r) => covers(l.get(r.page) ?? [], r.from, r.to)).length;
  if (done === ranges.length) return "full";
  if (done) return "part";
  return ranges.some((r) => gaps(l.get(r.page) ?? [], r.from, r.to).some(([a, b]) => b - a < r.to - r.from)) ? "part" : "none";
}

/** Записывает выученное в ученика. Порядок заучивания прежних страниц сохраняется, новые встают в порядке пути. */
export function withLearned(s: Student, l: Learned, meta: MushafMeta): Student {
  const full = new Set([...l].filter(([p, spans]) => covers(spans, 0, linesOn(meta, p))).map(([p]) => p));
  const kept = s.hifz.memorized.filter((p) => full.has(p));
  const fresh: number[] = [];
  const seen = new Set(kept);
  for (const seg of learningPath(meta, s.direction)) {
    if (full.has(seg.page) && !seen.has(seg.page)) {
      seen.add(seg.page);
      fresh.push(seg.page);
    }
  }
  const parts: Record<string, Span[]> = {};
  for (const [p, spans] of l) if (!full.has(p) && spans.length) parts[p] = joinSpans(spans);
  return { ...s, hifz: { ...s.hifz, memorized: [...kept, ...fresh], parts } };
}

// ---------- порядок заучивания ----------

/** Строки суры по страницам. */
export function surahRanges(meta: MushafMeta, n: number): LineRange[] {
  const [p0, l0] = meta.surah[n - 1];
  const [p1, l1] = meta.surah[n] ?? [meta.pages, linesOn(meta, meta.pages)];
  const out: LineRange[] = [];
  for (let p = p0; p <= p1; p++) {
    const from = p === p0 ? l0 : 0;
    const to = p === p1 ? l1 : linesOn(meta, p);
    if (to > from) out.push({ page: p, from, to });
  }
  return out;
}

export function juzPages(meta: MushafMeta, j: number): number[] {
  const out: number[] = [];
  meta.page.forEach(([x], i) => x === j && out.push(i + 1));
  return out;
}

const whole = (meta: MushafMeta, p: number): LineRange => ({ page: p, from: 0, to: linesOn(meta, p) });
export const juzRanges = (meta: MushafMeta, j: number) => juzPages(meta, j).map((p) => whole(meta, p));

/** Суры джуза: номер и строки, которые лежат в этом джузе. */
export function juzSurahs(meta: MushafMeta, j: number): { n: number; ranges: LineRange[] }[] {
  const pages = new Set(juzPages(meta, j));
  const out: { n: number; ranges: LineRange[] }[] = [];
  for (let n = 1; n <= meta.surah.length; n++) {
    const ranges = surahRanges(meta, n).filter((r) => pages.has(r.page));
    if (ranges.length) out.push({ n, ranges });
  }
  return out;
}

const paths = new WeakMap<MushafMeta, Record<string, LineRange[]>>();

/** Порядок заучивания всего мусхафа. Снизу вверх: 30-й джуз сурами от последней, остальные джузы назад, внутри сверху вниз. */
export function learningPath(meta: MushafMeta, direction: 1 | -1): LineRange[] {
  const cached = paths.get(meta) ?? {};
  if (cached[direction]) return cached[direction];
  const out: LineRange[] = [];
  if (direction === 1) for (let p = 1; p <= meta.pages; p++) out.push(whole(meta, p));
  else {
    for (const s of juzSurahs(meta, 30).reverse()) out.push(...s.ranges);
    for (let j = 29; j >= 1; j--) out.push(...juzRanges(meta, j));
  }
  paths.set(meta, { ...cached, [direction]: out });
  return out;
}

type Learner = Pick<Student, "hifz" | "direction" | "volume">;

/** Следующий урок или null, если впереди всё выучено. */
export function nextLesson(s: Learner, meta: MushafMeta): LineRange | null {
  const l = learnedOf(s.hifz, meta);
  const path = learningPath(meta, s.direction);
  const free = (r: LineRange) => gaps(l.get(r.page) ?? [], r.from, r.to);
  const start = Math.max(0, path.findIndex((r) => r.page === s.hifz.cur.page));
  for (let i = start; i < path.length; i++) {
    const seg = path[i];
    const gap = free(seg)[0];
    if (!gap) continue;
    const count = linesOn(meta, seg.page);
    const r = nextLessonRange(seg.page, gap[0], count, s.volume, gap[1]);
    // Снизу вверх короткие суры одной страницы собираются в урок выбранного объёма.
    if (s.direction === -1 && s.volume !== "lines2" && r.from === seg.from && r.to === seg.to) {
      const cap = s.volume === "page" ? count : Math.ceil(count / 2);
      for (let k = i + 1; k < path.length; k++) {
        const up = path[k];
        if (up.page !== r.page || up.to !== r.from || r.to - up.from > cap) break;
        const g = free(up);
        if (g.length !== 1 || g[0][0] !== up.from || g[0][1] !== up.to) break;
        r.from = up.from;
      }
    }
    return r;
  }
  return null;
}

/** Где ученик сейчас: урок в работе, урок на сдаче или следующий. null: всё выучено. */
export function placeOf(s: Learner, meta: MushafMeta): LineRange | null {
  return s.hifz.pending ?? s.hifz.lesson?.range ?? nextLesson(s, meta);
}

/** С какой страницы учить дальше, если идти с начала пути. null: выучено всё. */
export function firstFree(l: Learned, meta: MushafMeta, direction: 1 | -1): number | null {
  return learningPath(meta, direction).find((r) => !covers(l.get(r.page) ?? [], r.from, r.to))?.page ?? null;
}

/** Ставит ученика на страницу: строка первая невыученная. */
export function atPage(s: Student, page: number, meta: MushafMeta): Student {
  const l = learnedOf(s.hifz, meta);
  const line = gaps(l.get(page) ?? [], 0, linesOn(meta, page))[0]?.[0] ?? 0;
  const next = withLearned(s, l, meta);
  return { ...next, hifz: { ...next.hifz, cur: { page, line } } };
}

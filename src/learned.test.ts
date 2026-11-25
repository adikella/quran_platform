import { describe, expect, it } from "vitest";
import { addRange, atPage, coverage, firstFree, gaps, juzRanges, juzSurahs, learnedOf, nextLesson, removeRange, surahRanges, withLearned, type Learned } from "./learned";
import { settle } from "./merge";
import { DEFAULT_METHOD } from "./method";
import { madani as meta } from "./testMeta";
import type { LineRange, Student, Volume } from "./types";

const blank = (direction: 1 | -1, volume: Volume = "lines2"): Student => ({
  id: "s1", name: "Али", mushaf: "madani", stage: "hifz", volume, direction, method: DEFAULT_METHOD, nazira: { next: 1, read: [] },
  hifz: { memorized: [], parts: {}, cur: { page: direction === 1 ? 1 : 604, line: 0 }, pending: null, lesson: null, manzilCursor: 0 },
  submissions: [], days: {},
});
const mark = (ranges: LineRange[], l: Learned = new Map()) => ranges.reduce(addRange, l);
/** Учит и сдаёт n уроков подряд. */
function learn(s: Student, n: number): { s: Student; lessons: LineRange[] } {
  const lessons: LineRange[] = [];
  for (let i = 0; i < n; i++) {
    const r = nextLesson(s, meta);
    if (!r) break;
    lessons.push(r);
    const sub = { id: `x${s.submissions.length}`, date: "2026-11-26", kind: "sabak" as const, ranges: [r], fromVerse: "", toVerse: "", errors: 0, notes: 0, grade: 5, passed: true, seconds: 1 };
    s = settle({ ...s, hifz: { ...s.hifz, pending: r } }, sub, undefined, meta);
  }
  return { s, lessons };
}
const text = (l: LineRange[]) => l.map((r) => `${r.page}:${r.from}-${r.to}`);

describe("отрезки", () => {
  it("пробелы", () => {
    expect(gaps([[2, 4], [6, 8]], 0, 10)).toEqual([[0, 2], [4, 6], [8, 10]]);
    expect(gaps([[0, 5], [4, 10]], 0, 10)).toEqual([]);
  });
  it("отметить и снять", () => {
    const l = mark([{ page: 3, from: 0, to: 15 }]);
    expect(removeRange(l, { page: 3, from: 4, to: 6 }).get(3)).toEqual([[0, 4], [6, 15]]);
    expect(removeRange(l, { page: 3, from: 0, to: 15 }).has(3)).toBe(false);
  });
  it("сура по строкам", () => {
    expect(surahRanges(meta, 78)).toEqual([{ page: 582, from: 0, to: 13 }, { page: 583, from: 0, to: 7 }]);
    expect(coverage(mark(surahRanges(meta, 78)), juzRanges(meta, 30))).toBe("part");
    expect(coverage(mark([{ page: 583, from: 0, to: 2 }]), surahRanges(meta, 78))).toBe("part");
    expect(coverage(new Map(), surahRanges(meta, 78))).toBe("none");
  });
  it("суры 30-го джуза закрывают его целиком", () => {
    const l = mark(juzSurahs(meta, 30).flatMap((s) => s.ranges));
    expect(coverage(l, juzRanges(meta, 30))).toBe("full");
    expect(juzSurahs(meta, 30)).toHaveLength(37);
  });
});

describe("выученное раньше", () => {
  it("10 джузов: учить с 11-го, страницы попадают в memorized", () => {
    const l = mark(Array.from({ length: 10 }, (_, i) => juzRanges(meta, i + 1)).flat());
    const page = firstFree(l, meta, 1)!;
    const s = atPage(withLearned(blank(1, "page"), l, meta), page, meta);
    expect(page).toBe(202);
    expect(s.hifz.memorized).toHaveLength(201);
    expect(nextLesson(s, meta)).toEqual({ page: 202, from: 0, to: 15 });
  });
  it("дырка посередине: до неё доходят по пути и перескакивают выученное", () => {
    const s = withLearned(blank(1, "page"), mark([{ page: 2, from: 0, to: 6 }]), meta);
    expect(text(learn(s, 2).lessons)).toEqual(["1:0-7", "3:0-15"]);
    const h = withLearned(blank(1, "page"), mark([{ page: 3, from: 0, to: 6 }]), meta);
    expect(text(learn(h, 3).lessons)).toEqual(["1:0-7", "2:0-6", "3:6-15"]);
  });
  it("старая запись без parts читается по cur.line и не теряется", () => {
    const old = { ...blank(1), hifz: { ...blank(1).hifz, parts: undefined, memorized: [1, 2], cur: { page: 3, line: 8 } } };
    expect(learnedOf(old.hifz, meta).get(3)).toEqual([[0, 8]]);
    expect(nextLesson(old, meta)).toEqual({ page: 3, from: 8, to: 10 });
    const { s } = learn(old, 1);
    expect(s.hifz.parts).toEqual({ 3: [[0, 10]] });
    expect(s.hifz.memorized).toEqual([1, 2]);
  });
  it("порядок прежних страниц не меняется, снятая страница уходит", () => {
    const s = withLearned({ ...blank(1), hifz: { ...blank(1).hifz, memorized: [5, 4] } }, mark([4, 5, 1].map((p) => ({ page: p, from: 0, to: 15 }))), meta);
    expect(s.hifz.memorized).toEqual([5, 4, 1]);
    expect(withLearned(s, removeRange(learnedOf(s.hifz, meta), { page: 4, from: 0, to: 15 }), meta).hifz.memorized).toEqual([5, 1]);
  });
});

describe("снизу вверх", () => {
  it("2 строки: суры от «Ан-Нас», внутри суры сверху вниз", () => {
    expect(text(learn(blank(-1), 4).lessons)).toEqual(["604:5-7", "604:7-9", "604:2-5", "604:0-2"]);
  });
  it("страница: короткие суры одной страницы берутся вместе", () => {
    expect(text(learn(blank(-1, "page"), 1).lessons)).toEqual(["604:0-9"]);
    expect(learn(blank(-1, "page"), 1).s.hifz.memorized).toEqual([604]);
  });
  it.each(["lines2", "half", "page"] as Volume[])("%s: выучивается весь мусхаф, 30-й джуз первым", (v) => {
    const { s, lessons } = learn(blank(-1, v), 100000);
    expect(s.hifz.memorized).toHaveLength(604);
    const total = lessons.reduce((n, r) => n + r.to - r.from, 0);
    expect(total).toBe(meta.page.reduce((n, p) => n + p[3], 0));
    expect(s.hifz.memorized.slice(0, 23).every((p) => p >= 582)).toBe(true);
    expect(s.hifz.memorized.slice(23, 25)).toEqual([562, 563]);
  }, 60_000);
  it("сура на две страницы: сначала её начало", () => {
    const l = text(learn(blank(-1, "page"), 60).lessons);
    expect(l.indexOf("582:0-13")).toBeLessThan(l.indexOf("583:0-7"));
    expect(l.indexOf("583:7-" + meta.page[582][3])).toBeLessThan(l.indexOf("582:0-13"));
  });
  it("кто учил по страницам назад, строк не пропускает", () => {
    const old = { ...blank(-1, "page"), hifz: { ...blank(-1).hifz, parts: undefined, memorized: [604], cur: { page: 603, line: 0 } } };
    const { s } = learn(old, 100000);
    expect(s.hifz.memorized).toHaveLength(604);
  }, 60_000);
});

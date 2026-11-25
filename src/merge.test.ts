import { describe, expect, it } from "vitest";
import { mergeStudents, settle } from "./merge";
import { DEFAULT_METHOD } from "./method";
import type { MushafMeta, Student, Submission } from "./types";
import { madani } from "./testMeta";

const base: Student = {
  id: "s1", name: "Али", mushaf: "madani", stage: "hifz", volume: "half", direction: 1, method: DEFAULT_METHOD,
  nazira: { next: 1, read: [] },
  hifz: { memorized: [3], cur: { page: 4, line: 0 }, pending: { page: 4, from: 0, to: 8 }, lesson: null, manzilCursor: 0 },
  submissions: [], days: {}, updatedAt: 100,
};
const sub = (o: Partial<Submission> = {}): Submission => ({
  id: "a", date: "2026-11-25", kind: "sabak", ranges: [{ page: 4, from: 0, to: 8 }], fromVerse: "2:17", toVerse: "2:20",
  errors: 0, notes: 0, grade: 5, passed: true, seconds: 60, ...o,
});
const meta: MushafMeta = madani;
const apply = (s: Student, x: Submission, groups?: number) => settle(s, x, groups, meta);

describe("settle", () => {
  it("принятый урок двигает дальше по странице", () => {
    const r = apply(base, sub());
    expect(r.hifz.pending).toBeNull();
    expect(r.hifz.cur).toEqual({ page: 4, line: 8 });
    expect(r.days["2026-11-25"].seconds.sabak).toBe(60);
  });
  it("конец страницы: страница выучена", () => {
    const s = { ...base, hifz: { ...base.hifz, cur: { page: 4, line: 8 }, pending: { page: 4, from: 8, to: 15 } } };
    const r = apply(s, sub({ ranges: [{ page: 4, from: 8, to: 15 }] }));
    expect(r.hifz.memorized).toEqual([3, 4]);
    expect(r.hifz.cur).toEqual({ page: 5, line: 0 });
  });
  it("одно решение учителя не засчитывается дважды", () => {
    const once = apply(base, sub());
    expect(apply(once, sub())).toBe(once);
  });
  it("непринятый урок остаётся на пересдачу", () => {
    const r = apply(base, sub({ passed: false, grade: 2 }));
    expect(r.hifz.pending).toEqual(base.hifz.pending);
    expect(r.submissions).toHaveLength(1);
  });
  it("решение по другому уроку прогресс не двигает", () => {
    const r = apply(base, sub({ ranges: [{ page: 4, from: 0, to: 15 }] }));
    expect(r.hifz).toEqual(base.hifz);
    expect(r.submissions).toHaveLength(1);
  });
  it("давнее идёт по кругу", () => {
    const r = apply(base, sub({ kind: "manzil", ranges: [{ page: 1, from: 0, to: 7 }, { page: 21, from: 0, to: 15 }] }), 2);
    expect(r.hifz.manzilCursor).toBe(2);
    expect(r.hifz.manzilAt).toBe(21);
  });
});

describe("mergeStudents", () => {
  it("старое устройство с поздней мелкой правкой не откатывает заучивание", () => {
    const ahead = { ...apply(base, sub()), updatedAt: 200 };
    const stale = { ...base, name: "Вали", updatedAt: 300 };
    const r = mergeStudents(stale, ahead);
    expect(r.hifz.cur).toEqual({ page: 4, line: 8 });
    expect(r.name).toBe("Вали");
    expect(r.submissions.map((x) => x.id)).toEqual(["a"]);
  });
  it("порядок не важен", () => {
    const x = { ...apply(base, sub()), updatedAt: 200 };
    const y = { ...apply(base, sub({ id: "b", kind: "sabki", ranges: [{ page: 3, from: 0, to: 15 }] })), updatedAt: 300 };
    expect(mergeStudents(x, y)).toEqual(mergeStudents(y, x));
    expect(mergeStudents(x, y).submissions).toHaveLength(2);
  });
  it("повторения и время дня не складываются дважды и не теряются", () => {
    const day = (reps: number, sabak: number) => ({ d: { reps, seconds: { sabak }, learned: [] } });
    const r = mergeStudents({ ...base, days: day(50, 10) }, { ...base, days: day(30, 40) });
    expect(r.days.d).toEqual({ reps: 50, seconds: { sabak: 40 }, learned: [] });
  });
  it("круг давнего берётся с того устройства, где его сдавали", () => {
    const x = { ...apply(base, sub({ kind: "manzil", ranges: [{ page: 21, from: 0, to: 15 }] })), updatedAt: 200 };
    expect(mergeStudents({ ...base, name: "Вали", updatedAt: 300 }, x).hifz.manzilAt).toBe(21);
  });
  it("отмеченное выученным не откатывается старой копией", () => {
    const marked = { ...base, updatedAt: 200, hifz: { ...base.hifz, memorized: [], parts: { 583: [[0, 7]] as [number, number][] } } };
    const empty = { ...base, updatedAt: 300, hifz: { ...base.hifz, memorized: [] } };
    expect(mergeStudents(empty, marked).hifz.parts).toEqual({ 583: [[0, 7]] });
  });
  it("выученный урок важнее урока в работе", () => {
    const learning = { ...base, updatedAt: 500, hifz: { ...base.hifz, pending: null, lesson: { range: base.hifz.pending!, step: 1, done: 2 } } };
    expect(mergeStudents(learning, base).hifz.pending).toEqual(base.hifz.pending);
  });
  it("смена места в мусхафе берётся из свежей копии", () => {
    const moved = { ...base, updatedAt: 500, hifz: { ...base.hifz, pending: null, cur: { page: 600, line: 0 } } };
    expect(mergeStudents(base, moved).hifz.cur.page).toBe(600);
  });
});

import { describe, expect, it } from "vitest";
import { buildSteps, chunkLines, DEFAULT_METHOD, gradeFor, nextLessonRange, revision } from "./method";
import type { Student } from "./types";

describe("chunkLines", () => {
  it("делит 15 строк на пары, последний кусок — 13–15", () => {
    const c = chunkLines(0, 15);
    expect(c).toHaveLength(7);
    expect(c[0]).toEqual([0, 2]);
    expect(c[6]).toEqual([12, 15]);
  });
  it("чётное число строк — только пары", () => {
    expect(chunkLines(0, 6)).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
    ]);
  });
  it("2 или 3 строки — один кусок", () => {
    expect(chunkLines(4, 6)).toEqual([[4, 6]]);
    expect(chunkLines(12, 15)).toEqual([[12, 15]]);
  });
});

describe("nextLessonRange", () => {
  it("2 строки в день, в конце страницы — 3 строки", () => {
    expect(nextLessonRange(5, 0, 15, "lines2")).toEqual({ page: 5, from: 0, to: 2 });
    expect(nextLessonRange(5, 12, 15, "lines2")).toEqual({ page: 5, from: 12, to: 15 });
  });
  it("полстраницы: сначала первая половина, потом остальное", () => {
    expect(nextLessonRange(5, 0, 15, "half")).toEqual({ page: 5, from: 0, to: 8 });
    expect(nextLessonRange(5, 8, 15, "half")).toEqual({ page: 5, from: 8, to: 15 });
  });
  it("страница целиком", () => {
    expect(nextLessonRange(5, 0, 15, "page")).toEqual({ page: 5, from: 0, to: 15 });
  });
});

describe("buildSteps", () => {
  it("урок из 4 строк: 20 раз страница, 5+5+20 на кусок, соединение 20, весь урок 20", () => {
    const steps = buildSteps({ page: 1, from: 0, to: 4 }, 15, DEFAULT_METHOD);
    expect(steps.map((s) => [s.kind, s.reps])).toEqual([
      ["readFirst", 20],
      ["look", 5],
      ["blind", 5],
      ["heart", 20],
      ["look", 5],
      ["blind", 5],
      ["heart", 20],
      ["join", 20],
      ["whole", 20],
    ]);
    expect(steps[0].range).toEqual({ page: 1, from: 0, to: 15 });
    expect(steps[7].range).toEqual({ page: 1, from: 0, to: 4 });
    expect(steps[2].hidden).toBe(true);
  });
  it("урок не с начала страницы — сначала 20 раз читают только урок", () => {
    const steps = buildSteps({ page: 1, from: 4, to: 6 }, 15, DEFAULT_METHOD);
    expect(steps[0].range).toEqual({ page: 1, from: 4, to: 6 });
    expect(steps.some((s) => s.kind === "whole")).toBe(false);
  });
  it("10 по мусхафу + 10 наизусть", () => {
    const steps = buildSteps({ page: 1, from: 0, to: 2 }, 15, { ...DEFAULT_METHOD, heartSplit: true });
    const heart = steps.filter((s) => s.kind === "heart");
    expect(heart.map((s) => [s.reps, s.hidden])).toEqual([
      [10, false],
      [10, true],
    ]);
  });
});

describe("gradeFor", () => {
  it("0 — 5, 1 — 4, 2 — 3, 3 и больше — 2 и пересдача", () => {
    expect(gradeFor(0, 2)).toEqual({ grade: 5, passed: true });
    expect(gradeFor(1, 2)).toEqual({ grade: 4, passed: true });
    expect(gradeFor(2, 2)).toEqual({ grade: 3, passed: true });
    expect(gradeFor(3, 2)).toEqual({ grade: 2, passed: false });
  });
});

describe("revision", () => {
  const juzOf = (p: number) => Math.ceil(p / 20);
  const lines = () => 15;
  const student = (memorized: number[], line = 0, cursor = 0): Pick<Student, "hifz" | "method"> => ({
    method: DEFAULT_METHOD,
    hifz: {
      memorized,
      cur: { page: (memorized.at(-1) ?? 0) + 1, line },
      pending: null,
      lesson: null,
      manzilCursor: cursor,
    },
  });

  it("сабки — не больше 10 последних страниц, остальное сразу в манзиль", () => {
    const r = revision(student(Array.from({ length: 15 }, (_, i) => i + 1), 4), juzOf, lines);
    expect(r.sabki[0]).toEqual({ page: 16, from: 0, to: 4 });
    expect(r.sabki).toHaveLength(11);
    expect(r.manzilGroups).toEqual([{ juz: 1, pages: [1, 2, 3, 4, 5] }]);
  });

  it("манзиль — до 2 джузов за утро, по кругу", () => {
    const pages = Array.from({ length: 70 }, (_, i) => i + 1);
    const r0 = revision(student(pages, 0, 0), juzOf, lines);
    expect(r0.manzilGroups.map((g) => g.juz)).toEqual([1, 2, 3]);
    expect(r0.manzilToday.map((g) => g.juz)).toEqual([1, 2]);
    const r1 = revision(student(pages, 0, 2), juzOf, lines);
    expect(r1.manzilToday.map((g) => g.juz)).toEqual([3, 1]);
  });
});

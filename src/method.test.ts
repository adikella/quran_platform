import { describe, expect, it } from "vitest";
import { buildSteps, chunkLines, dayPart, DEFAULT_METHOD, gradeFor, manzilBefore, manzilDays, nextLessonRange, revision } from "./method";
import { madani } from "./testMeta";
import type { LineRange, Student } from "./types";

// Методика с шагом «наизусть 20 раз», который устаз может включить в настройках.
const M = { ...DEFAULT_METHOD, heart: 20 };

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
  it("урок из 4 строк: 20 раз страница, 10+10+20 на кусок, соединение 20, весь урок 20", () => {
    const steps = buildSteps({ page: 1, from: 0, to: 4 }, 15, M);
    expect(steps.map((s) => [s.kind, s.reps])).toEqual([
      ["readFirst", 20],
      ["look", 10],
      ["blind", 10],
      ["heart", 20],
      ["look", 10],
      ["blind", 10],
      ["heart", 20],
      ["join", 20],
      ["whole", 20],
      ["repeat", 60],
    ]);
    expect(steps[0].range).toEqual({ page: 1, from: 0, to: 15 });
    expect(steps[7].range).toEqual({ page: 1, from: 0, to: 4 });
    expect(steps[2].hidden).toBe(true);
  });
  it("урок не с начала страницы — сначала 20 раз читают только урок", () => {
    const steps = buildSteps({ page: 1, from: 4, to: 6 }, 15, M);
    expect(steps[0].range).toEqual({ page: 1, from: 4, to: 6 });
    expect(steps.some((s) => s.kind === "whole")).toBe(false);
  });
  it("10 по мусхафу + 10 наизусть", () => {
    const steps = buildSteps({ page: 1, from: 0, to: 2 }, 15, { ...M, heartSplit: true });
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

describe("соединение", () => {
  const joins = (range: LineRange, count: number, known?: [number, number][], prev?: LineRange) =>
    buildSteps(range, count, DEFAULT_METHOD, prev, { oneChunk: true, known }).filter((s) => s.kind === "join").map((s) => [s.range.from, s.range.to]);
  it("последняя сура страницы не соединяется с невыученным перед ней", () => {
    expect(joins({ page: 604, from: 5, to: 9 }, 9, [])).toEqual([]);
  });
  it("урок, который закрыл страницу, соединяется со всей страницей", () => {
    expect(joins({ page: 604, from: 0, to: 2 }, 9, [[2, 9]])).toEqual([[0, 9]]);
    expect(joins({ page: 5, from: 8, to: 15 }, 15)).toEqual([[0, 15]]);
  });
  it("целая страница одним уроком не соединяется", () => {
    expect(joins({ page: 5, from: 0, to: 15 }, 15)).toEqual([]);
  });
});

describe("revision", () => {
  const student = (pages: number[], o: Partial<Student["hifz"]> = {}, method = {}): Pick<Student, "hifz" | "method" | "direction" | "volume"> => ({
    method: { ...DEFAULT_METHOD, ...method },
    direction: 1,
    volume: "page",
    hifz: { memorized: pages, parts: {}, cur: { page: (pages.at(-1) ?? 0) + 1, line: 0 }, pending: null, lesson: null, manzilCursor: 0, ...o },
  });
  const upTo = (n: number, from = 1) => Array.from({ length: n - from + 1 }, (_, i) => from + i);
  const juz = (u: { juz: number }[]) => u.map((g) => g.juz);

  it("сабки сдаются пачками по 10: выучено 14, сдаются первые 10, остальные 4 ждут", () => {
    const r = revision(student(upTo(14)), madani);
    expect(r.sabki.map((x) => x.page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(r.sabkiWaiting).toEqual([11, 12, 13, 14]);
    expect(r.manzilQueue).toEqual([]);
  });
  it("прошлые джузы в манзиль, текущий в сабки", () => {
    const r = revision(student(upTo(44)), madani);
    expect(r.sabki.map((x) => x.page)).toEqual([42, 43, 44]);
    expect(juz(r.manzilQueue)).toEqual([1, 2]);
  });
  it("новичок: выучено меньше 10 страниц джуза, всё это сабки и манзиля нет", () => {
    const r = revision(student([1, 2, 3], { parts: undefined, cur: { page: 4, line: 4 } }), madani);
    expect(r.sabki.map((x) => x.page)).toEqual([1, 2, 3, 4]);
    expect(r.sabki[3]).toEqual({ page: 4, from: 0, to: 4 });
    expect(r.manzilToday).toEqual([]);
  });
  it("10 джузов: по 2 за утро, круг 5 дней, следующий после сданного", () => {
    const s = student(upTo(201));
    const r = revision(s, madani);
    expect(juz(r.manzilToday)).toEqual([1, 2]);
    expect(manzilDays(r, s.method)).toHaveLength(5);
    expect(juz(revision(student(upTo(201), { manzilAt: 41 }), madani).manzilToday)).toEqual([3, 4]);
    expect(juz(revision(student(upTo(201), { manzilAt: 201 }), madani).manzilToday)).toEqual([1, 2]);
  });
  it("новый выученный джуз не сбивает круг", () => {
    const r = revision(student(upTo(221), { manzilAt: 181, manzilCursor: 23 }), madani);
    expect(juz(r.manzilToday)).toEqual([10, 11]);
  });
  it("круг вверх и выбор, с чего начать", () => {
    const s = student(upTo(201), {}, { manzilDir: -1 });
    const r = revision(s, madani);
    expect(juz(r.manzilToday)).toEqual([10, 9]);
    const at = manzilBefore(r.manzilQueue, r.manzilQueue.find((u) => u.juz === 4)!);
    expect(juz(revision({ ...s, hifz: { ...s.hifz, manzilAt: at } }, madani).manzilToday)).toEqual([4, 3]);
  });
  it("снизу вверх: недавнее по порядку мусхафа, а не по порядку заучивания", () => {
    const s = { ...student([604, 603, 585], { parts: { 586: [[0, 1]], 599: [[0, 5]], 582: [[0, 13]] }, cur: { page: 598, line: 0 } }), direction: -1 as const };
    const r = revision(s, madani);
    expect(r.sabki.map((x) => x.page)).toEqual([582, 585, 586, 599, 603, 604]);
  });
  it("по половине джуза", () => {
    const s = student(upTo(41), {}, { manzilJuz: 0.5 });
    const r = revision(s, madani);
    expect(r.manzilQueue.map((u) => [u.juz, u.half])).toEqual([[1, 1], [1, 2], [2, 1], [2, 2]]);
    expect(r.manzilToday).toHaveLength(1);
    const next = revision({ ...s, hifz: { ...s.hifz, manzilAt: 11 } }, madani);
    expect([next.manzilToday[0].juz, next.manzilToday[0].half]).toEqual([1, 2]);
  });
  it("выученная сура чужого джуза идёт в манзиль по строкам", () => {
    const r = revision(student([1, 2, 582], { parts: { 583: [[0, 7]] }, cur: { page: 3, line: 0 } }), madani);
    expect(r.manzilToday).toEqual([{ juz: 30, ranges: [{ page: 582, from: 0, to: 13 }, { page: 583, from: 0, to: 7 }] }]);
  });
  it("весь мусхаф выучен: сабки нет, всё в манзиле", () => {
    const r = revision(student(upTo(604), { cur: { page: 604, line: 9 } }), madani);
    expect(r.sabki).toEqual([]);
    expect(r.manzilQueue).toHaveLength(30);
  });
});

describe("dayPart", () => {
  const at = (h: number, m = 0) => new Date(2026, 0, 5, h, m);
  const mm = { morningStart: "08:00", morningEnd: "10:00" };
  it("распорядок дня по часам", () => {
    expect(dayPart(at(3), mm)).toBe("sleep");
    expect(dayPart(at(5), mm)).toBe("submit");
    expect(dayPart(at(8), mm)).toBe("morning");
    expect(dayPart(at(11), mm)).toBe("rest");
    expect(dayPart(at(13), mm)).toBe("learn");
    expect(dayPart(at(16), mm)).toBe("break");
    expect(dayPart(at(19), mm)).toBe("prepare");
    expect(dayPart(at(20, 30), mm)).toBe("old");
    expect(dayPart(at(22), mm)).toBe("sleep");
  });
});

describe("соединение с прошлым уроком", () => {
  it("после урока 1–2 урок 3–4 кончается соединением 1–4", () => {
    const steps = buildSteps({ page: 3, from: 2, to: 4 }, 15, M, { page: 3, from: 0, to: 2 });
    const last = steps[steps.length - 2];
    expect(last.kind).toBe("join");
    expect(last.range).toEqual({ page: 3, from: 0, to: 4 });
    expect(last.reps).toBe(M.join);
    expect(last.hidden).toBe(false);
  });
  it("первый урок на странице без соединения", () => {
    const steps = buildSteps({ page: 3, from: 0, to: 2 }, 15, M);
    expect(steps.some((s) => s.kind === "join")).toBe(false);
  });
});

describe("соединение в конце страницы", () => {
  it("последний урок страницы соединяется со всей страницей", () => {
    const steps = buildSteps({ page: 3, from: 12, to: 15 }, 15, M, { page: 3, from: 10, to: 12 });
    const last = steps[steps.length - 2];
    expect(last.kind).toBe("join");
    expect(last.range).toEqual({ page: 3, from: 0, to: 15 });
  });
});

describe("повторение до нормы", () => {
  it("урок из 2 строк добирается до 200 повторений", () => {
    const steps = buildSteps({ page: 3, from: 2, to: 4 }, 15, M, { page: 3, from: 0, to: 2 });
    const last = steps[steps.length - 1];
    expect(last.kind).toBe("repeat");
    expect(last.range).toEqual({ page: 3, from: 0, to: 4 });
    expect(steps.reduce((n, s) => n + s.reps, 0)).toBe(M.dailyTarget);
  });
  it("если шаги уже дают норму, повтора нет", () => {
    const steps = buildSteps({ page: 3, from: 0, to: 15 }, 15, M);
    expect(steps.some((s) => s.kind === "repeat")).toBe(false);
  });
});

describe("урок одним куском (полстраницы и страница)", () => {
  it("страница: читать 20, глядя 10, не глядя 10, без «наизусть 20», повторять до 200", () => {
    const steps = buildSteps({ page: 5, from: 0, to: 15 }, 15, DEFAULT_METHOD, undefined, { oneChunk: true });
    expect(steps.map((s) => [s.kind, s.reps])).toEqual([
      ["readFirst", 20],
      ["look", 10],
      ["blind", 10],
      ["repeat", 160],
    ]);
    expect(steps[3].range).toEqual({ page: 5, from: 0, to: 15 });
  });
  it("вторая половина страницы одним куском и соединение всей страницы", () => {
    const steps = buildSteps({ page: 5, from: 8, to: 15 }, 15, DEFAULT_METHOD, { page: 5, from: 0, to: 8 }, { oneChunk: true });
    expect(steps.map((s) => s.kind)).toEqual(["readFirst", "look", "blind", "join", "repeat"]);
    expect(steps[1].range).toEqual({ page: 5, from: 8, to: 15 });
    expect(steps[3].range).toEqual({ page: 5, from: 0, to: 15 });
  });
  it("2 строки по умолчанию: 20, 10, 10, соединение 20, повтор до 200", () => {
    const steps = buildSteps({ page: 3, from: 2, to: 4 }, 15, DEFAULT_METHOD, { page: 3, from: 0, to: 2 });
    expect(steps.map((s) => [s.kind, s.reps])).toEqual([
      ["readFirst", 20],
      ["look", 10],
      ["blind", 10],
      ["join", 20],
      ["repeat", 140],
    ]);
  });
});

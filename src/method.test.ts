import { describe, expect, it } from "vitest";
import { buildSteps, chunkLines, dayPart, DEFAULT_METHOD, gradeFor, nextLessonRange, revision } from "./method";
import type { Student } from "./types";

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

  it("сабки сдаются пачками по 10: выучено 14, сдаются первые 10, остальные 4 ждут", () => {
    const r = revision(student(Array.from({ length: 14 }, (_, i) => i + 1), 0), juzOf, lines);
    expect(r.sabki.map((x) => x.page)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(r.sabkiWaiting).toEqual([11, 12, 13, 14]);
    expect(r.manzilGroups).toEqual([]);
  });

  it("выучено 24 страницы джуза: сдаётся вторая пачка (11–20), прошлые джузы в манзиль", () => {
    // juzOf здесь по 30 страниц, чтобы в джузе поместилось больше двух пачек
    const juz30 = (p: number) => Math.ceil(p / 30);
    const r = revision(student(Array.from({ length: 54 }, (_, i) => i + 1), 0), juz30, lines);
    // страницы 31–54 это джуз 2: выучено 24, полных пачек 2, сдаются страницы 41–50
    expect(r.sabki.map((x) => x.page)).toEqual([50, 49, 48, 47, 46, 45, 44, 43, 42, 41]);
    expect(r.manzilGroups.map((g) => g.juz)).toEqual([1]);
  });

  it("новичок: пока выучено меньше 10 страниц одного джуза, всё это сабки и манзиля нет", () => {
    const r = revision(student([1, 2, 3], 4), juzOf, lines);
    expect(r.sabki[0]).toEqual({ page: 4, from: 0, to: 4 });
    expect(r.sabki.slice(1).map((x) => x.page)).toEqual([3, 2, 1]);
    expect(r.manzilGroups).toEqual([]);
    expect(r.manzilToday).toEqual([]);
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

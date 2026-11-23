// Методика заучивания: чистые функции без интерфейса, чтобы их можно было проверить тестами.

import type { LineRange, Method, Step, Student, Volume } from "./types";

export const DEFAULT_METHOD: Method = {
  readFirst: 20,
  look: 5,
  blind: 5,
  heart: 20,
  heartSplit: false,
  join: 20,
  whole: 20,
  dailyTarget: 200,
  maxErrors: 2,
  sabkiPages: 10,
  manzilJuz: 2,
  naziraJuz: 3,
  morningStart: "08:00",
  morningEnd: "10:00",
};

/**
 * Делит строки [from, to) на куски по 2 строки.
 * Если остаётся одна лишняя строка, она присоединяется к последнему куску
 * (на странице в 15 строк последний кусок — 13–15).
 */
export function chunkLines(from: number, to: number): [number, number][] {
  const n = to - from;
  if (n <= 0) return [];
  if (n <= 3) return [[from, to]];
  const chunks: [number, number][] = [];
  let a = from;
  while (to - a > 3) {
    chunks.push([a, a + 2]);
    a += 2;
  }
  chunks.push([a, to]);
  return chunks;
}

/** Какие строки страницы взять в следующий урок, начиная со строки `from`. */
export function nextLessonRange(page: number, from: number, lineCount: number, volume: Volume): LineRange {
  const left = lineCount - from;
  let size: number;
  if (volume === "page") size = left;
  else if (volume === "half") {
    const half = Math.ceil(lineCount / 2);
    // Первая половина — до середины страницы, вторая — до конца.
    size = from < half ? half - from : left;
  } else size = 2;
  // Не оставлять в конце страницы одну строку: она уходит в этот урок.
  if (left - size === 1) size += 1;
  size = Math.max(1, Math.min(size, left));
  return { page, from, to: from + size };
}

/** Шаги урока по методике. `lineCount` — число строк на странице урока. */
export function buildSteps(range: LineRange, lineCount: number, m: Method): Step[] {
  const steps: Step[] = [];
  const { page } = range;
  // Перед заучиванием читают всю страницу; если урок начинается не с начала страницы — только урок.
  const first: LineRange = range.from === 0 ? { page, from: 0, to: lineCount } : range;
  if (m.readFirst > 0) steps.push({ kind: "readFirst", range: first, hidden: false, reps: m.readFirst, chunk: -1 });

  const chunks = chunkLines(range.from, range.to);
  chunks.forEach(([a, b], i) => {
    const r: LineRange = { page, from: a, to: b };
    if (m.look > 0) steps.push({ kind: "look", range: r, hidden: false, reps: m.look, chunk: i });
    if (m.blind > 0) steps.push({ kind: "blind", range: r, hidden: true, reps: m.blind, chunk: i });
    if (m.heart > 0) {
      if (m.heartSplit) {
        const half = Math.ceil(m.heart / 2);
        steps.push({ kind: "heart", range: r, hidden: false, reps: half, chunk: i });
        if (m.heart - half > 0) steps.push({ kind: "heart", range: r, hidden: true, reps: m.heart - half, chunk: i });
      } else {
        steps.push({ kind: "heart", range: r, hidden: true, reps: m.heart, chunk: i });
      }
    }
    if (i > 0 && m.join > 0) {
      const prev = chunks[i - 1];
      steps.push({ kind: "join", range: { page, from: prev[0], to: b }, hidden: true, reps: m.join, chunk: i });
    }
  });

  if (chunks.length > 1 && m.whole > 0) {
    steps.push({ kind: "whole", range, hidden: true, reps: m.whole, chunk: chunks.length });
  }
  return steps;
}

/** Оценка по 5 баллам: 0 ошибок — 5, 1 — 4, 2 — 3, больше — 2 и пересдача. */
export function gradeFor(errors: number, maxErrors: number): { grade: number; passed: boolean } {
  const passed = errors <= maxErrors;
  if (!passed) return { grade: 2, passed };
  return { grade: Math.max(3, 5 - errors), passed };
}

/** Следующая страница в выбранном направлении или null, если мусхаф закончился. */
export function stepPage(page: number, direction: 1 | -1, pages: number): number | null {
  const p = page + direction;
  return p >= 1 && p <= pages ? p : null;
}

export interface Revision {
  /** Сабки: недавно выученное — сданные строки текущей страницы и последние страницы. */
  sabki: LineRange[];
  /** Все группы манзиля (по джузам), в порядке заучивания. */
  manzilGroups: { juz: number; pages: number[] }[];
  /** Группы манзиля на сегодня. */
  manzilToday: { juz: number; pages: number[] }[];
}

/**
 * Делит выученное на сабки и манзиль.
 * Сабки — последние `sabkiPages` страниц (и уже сданные строки текущей страницы).
 * Всё, что раньше, сразу уходит в манзиль; манзиль сдают по `manzilJuz` джуза за утро, по кругу.
 */
export function revision(
  student: Pick<Student, "hifz" | "method">,
  juzOf: (page: number) => number,
  lineCount: (page: number) => number,
): Revision {
  const { memorized, cur, manzilCursor } = student.hifz;
  const m = student.method;
  const sabki: LineRange[] = [];
  if (cur.line > 0) sabki.push({ page: cur.page, from: 0, to: cur.line });
  const recent = memorized.slice(Math.max(0, memorized.length - m.sabkiPages));
  for (let i = recent.length - 1; i >= 0; i--) {
    const p = recent[i];
    sabki.push({ page: p, from: 0, to: lineCount(p) });
  }

  const old = memorized.slice(0, Math.max(0, memorized.length - m.sabkiPages));
  const manzilGroups: { juz: number; pages: number[] }[] = [];
  for (const p of old) {
    const j = juzOf(p);
    const last = manzilGroups[manzilGroups.length - 1];
    if (last && last.juz === j) last.pages.push(p);
    else manzilGroups.push({ juz: j, pages: [p] });
  }

  const manzilToday: { juz: number; pages: number[] }[] = [];
  if (manzilGroups.length) {
    const count = Math.min(m.manzilJuz, manzilGroups.length);
    for (let i = 0; i < count; i++) {
      manzilToday.push(manzilGroups[(manzilCursor + i) % manzilGroups.length]);
    }
  }
  return { sabki, manzilGroups, manzilToday };
}

/** Сколько страниц нужно прочитать на этапе назиры (примерно 20 страниц в джузе). */
export function naziraTargetPages(m: Method): number {
  return m.naziraJuz * 20;
}

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

/** Минуты до времени "HH:MM" сегодня (отрицательное — время уже прошло). */
export function secondsUntil(hhmm: string, now = new Date()): number {
  const [h, mi] = hhmm.split(":").map(Number);
  const t = new Date(now);
  t.setHours(h, mi, 0, 0);
  return Math.round((t.getTime() - now.getTime()) / 1000);
}

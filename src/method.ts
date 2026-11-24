// Методика заучивания: чистые функции без интерфейса, чтобы их можно было проверить тестами.

import type { LineRange, Method, Step, Student, Volume } from "./types";

export const DEFAULT_METHOD: Method = {
  readFirst: 20,
  look: 10,
  blind: 10,
  heart: 0,
  heartSplit: false,
  join: 20,
  whole: 20,
  dailyTarget: 200,
  maxErrors: 2,
  sabkiPages: 10,
  manzilJuz: 2,
  naziraJuz: 3,
  sessionMinutes: 15,
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

/**
 * Сколько первых слов следующей строки цеплять на каждом шаге заучивания (учишь 1–2, цепляешь слово из 3-й).
 * Это слово всё равно входит в следующий урок.
 */
export const BRIDGE_WORDS = 1;

/**
 * Какие строки страницы взять в следующий урок, начиная со строки `from`.
 * Урок не продлевается до конца аята: продолжение цепляется словом-мостиком (BRIDGE_WORDS).
 */
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

export interface StepOptions {
  /** Учить урок одним куском, без нарезки по 2 строки (объём «полстраницы» и «страница»). */
  oneChunk?: boolean;
}

/** Шаги урока по методике. `lineCount` — число строк на странице урока. */
export function buildSteps(range: LineRange, lineCount: number, m: Method, prev?: LineRange, opts: StepOptions = {}): Step[] {
  const steps: Step[] = [];
  const { page } = range;
  // Перед заучиванием читают всю страницу; если урок начинается не с начала страницы — только урок.
  const first: LineRange = range.from === 0 ? { page, from: 0, to: lineCount } : range;
  if (m.readFirst > 0) steps.push({ kind: "readFirst", range: first, hidden: false, reps: m.readFirst, chunk: -1 });

  const chunks: [number, number][] = opts.oneChunk ? [[range.from, range.to]] : chunkLines(range.from, range.to);
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
  // Соединение с прошлым уроком на этой же странице: выучил 1–2, теперь 3–4, в конце читает 1–4.
  // Последний урок страницы соединяется со всей страницей.
  const pageDone = range.to >= lineCount && range.from > 0;
  if (m.join > 0 && (pageDone || (prev && prev.page === page && prev.to === range.from && prev.from < range.from))) {
    const from = pageDone ? 0 : prev!.from;
    steps.push({ kind: "join", range: { page, from, to: range.to }, hidden: true, reps: m.join, chunk: chunks.length + 1 });
  }
  // Повторять урок наизусть, пока за урок не наберётся дневная норма (по умолчанию 200).
  const total = steps.reduce((n, st) => n + st.reps, 0);
  const last = steps[steps.length - 1];
  if (m.dailyTarget > total && last) {
    const r = last.kind === "join" || last.kind === "whole" ? last.range : range;
    steps.push({ kind: "repeat", range: r, hidden: true, reps: m.dailyTarget - total, chunk: chunks.length + 2 });
  }
  return steps;
}

/** Прошлый сданный урок, который кончается там, где начинается этот (для соединения). */
export function previousLesson(s: Student, range: LineRange): LineRange | undefined {
  for (let i = s.submissions.length - 1; i >= 0; i--) {
    const sub = s.submissions[i];
    if (sub.kind !== "sabak" || !sub.passed) continue;
    const r = sub.ranges[0];
    if (r && r.page === range.page && r.to === range.from) return r;
  }
  if (range.from > 0) return { page: range.page, from: Math.max(0, range.from - 2), to: range.from };
  return undefined;
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
  /** Сабки: учится сейчас — сданные строки текущей страницы и выученные страницы текущего джуза. */
  sabki: LineRange[];
  /** Выученные страницы текущего джуза, которые ждут, пока наберётся полная пачка. */
  sabkiWaiting: number[];
  /** Все группы манзиля (по джузам), в порядке заучивания. */
  manzilGroups: { juz: number; pages: number[] }[];
  /** Группы манзиля на сегодня. */
  manzilToday: { juz: number; pages: number[] }[];
}

/**
 * Делит выученное на сабки и манзиль.
 * Сабки — то, что учится сейчас: страницы текущего джуза, которые сдают пачками по `sabkiPages` (10).
 * Выучено 14 страниц: сдаются первые 10, остальные 4 ждут, пока наберётся ещё 10.
 * Пока в джузе меньше одной полной пачки (новичок), сдают всё, что есть, включая сданные строки текущей страницы.
 * Манзиль — выученные страницы остальных джузов; его сдают по `manzilJuz` джуза за утро, по кругу.
 */
export function revision(
  student: Pick<Student, "hifz" | "method">,
  juzOf: (page: number) => number,
  lineCount: (page: number) => number,
): Revision {
  const { memorized, cur, manzilCursor } = student.hifz;
  const m = student.method;
  const sabki: LineRange[] = [];
  const curJuz = juzOf(cur.page);
  const inCurrent = memorized.filter((p) => juzOf(p) === curJuz);
  const block = Math.max(1, m.sabkiPages);
  const fullBlocks = Math.floor(inCurrent.length / block);
  const recent = fullBlocks > 0 ? inCurrent.slice((fullBlocks - 1) * block, fullBlocks * block) : inCurrent;
  if (fullBlocks === 0 && cur.line > 0) sabki.push({ page: cur.page, from: 0, to: cur.line });
  const sabkiWaiting = fullBlocks > 0 ? inCurrent.slice(fullBlocks * block) : [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const p = recent[i];
    sabki.push({ page: p, from: 0, to: lineCount(p) });
  }

  const old = memorized.filter((p) => juzOf(p) !== curJuz);
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
  return { sabki, sabkiWaiting, manzilGroups, manzilToday };
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

export type DayPart = "sleep" | "submit" | "morning" | "rest" | "learn" | "break" | "prepare" | "old";

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/**
 * Что сейчас по распорядку дня. Пока по часам; позже окна привяжем к времени намазов города ученика
 * (после фаджра, после зухра, между магрибом и иша).
 */
export function dayPart(now: Date, m: Pick<Method, "morningStart" | "morningEnd">): DayPart {
  const t = now.getHours() * 60 + now.getMinutes();
  const a = toMin(m.morningStart);
  const b = toMin(m.morningEnd);
  if (t < 4 * 60) return "sleep";
  if (t < a) return "submit";
  if (t < b) return "morning";
  if (t < 12 * 60 + 30) return "rest";
  if (t < 15 * 60 + 30) return "learn";
  if (t < 18 * 60 + 30) return "break";
  if (t < 20 * 60) return "prepare";
  if (t < 21 * 60 + 30) return "old";
  return "sleep";
}

// Методика заучивания: чистые функции без интерфейса, чтобы их можно было проверить тестами.

import { covers, gaps, juzOf, juzPages, learnedOf, linesOn, placeOf, type Span } from "./learned";
import type { LineRange, Method, MushafMeta, Step, Student, Volume } from "./types";

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
  remindAt: "08:00",
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
 * Какие строки страницы взять в следующий урок, начиная со строки `from` и не дальше строки `end`
 * (за ней уже выученное или другая сура).
 * Урок не продлевается до конца аята: продолжение цепляется словом-мостиком (BRIDGE_WORDS).
 */
export function nextLessonRange(page: number, from: number, lineCount: number, volume: Volume, end = lineCount): LineRange {
  const left = end - from;
  let size: number;
  if (volume === "page") size = left;
  else if (volume === "half") {
    const half = Math.ceil(lineCount / 2);
    // Первая половина: до середины страницы, вторая: до конца. Обрывок у самой середины отдельным уроком не бывает.
    if (half - from >= 4) size = half - from;
    else size = left <= half ? left : half;
  } else size = 2;
  // Не оставлять в конце страницы одну строку: она уходит в этот урок.
  if (left - size === 1) size += 1;
  size = Math.max(1, Math.min(size, left));
  return { page, from, to: from + size };
}

export interface StepOptions {
  /** Учить урок одним куском, без нарезки по 2 строки (объём «полстраницы» и «страница»). */
  oneChunk?: boolean;
  /** Что на этой странице уже выучено. По умолчанию всё до начала урока. */
  known?: Span[];
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
      steps.push({ kind: "join", range: { page, from: prev[0], to: b }, hidden: false, reps: m.join, chunk: i });
    }
  });

  if (chunks.length > 1 && m.whole > 0) {
    steps.push({ kind: "whole", range, hidden: true, reps: m.whole, chunk: chunks.length });
  }
  // Соединение с прошлым уроком на этой же странице: выучил 1–2, теперь 3–4, в конце читает 1–4.
  // Урок, после которого выучена вся страница, соединяется со всей страницей.
  const known = opts.known ?? [[0, range.from] as Span];
  const part = range.from > 0 || range.to < lineCount;
  const pageDone = part && covers([...known, [range.from, range.to]], 0, lineCount);
  const after = prev && prev.page === page && prev.to === range.from && prev.from < range.from && covers(known, prev.from, prev.to);
  if (m.join > 0 && (pageDone || after)) {
    const joined = pageDone ? { page, from: 0, to: lineCount } : { page, from: prev!.from, to: range.to };
    steps.push({ kind: "join", range: joined, hidden: false, reps: m.join, chunk: chunks.length + 1 });
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
export function previousLesson(s: Student, range: LineRange, known: Span[] = [[0, range.from]]): LineRange | undefined {
  for (let i = s.submissions.length - 1; i >= 0; i--) {
    const sub = s.submissions[i];
    if (sub.kind !== "sabak" || !sub.passed) continue;
    const r = sub.ranges[0];
    if (r && r.page === range.page && r.to === range.from) return r;
  }
  const from = Math.max(0, range.from - 2);
  if (range.from > 0 && gaps(known, from, range.from).length === 0) return { page: range.page, from, to: range.from };
  return undefined;
}

/** Оценка по 5 баллам: 0 ошибок — 5, 1 — 4, 2 — 3, больше — 2 и пересдача. */
export function gradeFor(errors: number, maxErrors: number): { grade: number; passed: boolean } {
  const passed = errors <= maxErrors;
  if (!passed) return { grade: 2, passed };
  return { grade: Math.max(3, 5 - errors), passed };
}

/** Группа манзиля: джуз или его половина. */
export interface ManzilUnit {
  juz: number;
  /** Половина джуза, если круг идёт половинами. */
  half?: 1 | 2;
  ranges: LineRange[];
}

export interface Revision {
  /** Сабки: учится сейчас, по порядку мусхафа. Сданные строки текущей страницы и выученные страницы текущего джуза. */
  sabki: LineRange[];
  /** Выученные страницы текущего джуза, которые ждут, пока наберётся полная пачка. */
  sabkiWaiting: number[];
  /** Весь круг манзиля, начиная с того, что на очереди. */
  manzilQueue: ManzilUnit[];
  /** Что сдавать сейчас. */
  manzilToday: ManzilUnit[];
}

export const manzilDir = (s: Pick<Student, "method" | "direction">): 1 | -1 => s.method.manzilDir ?? s.direction;

/** Порядок страниц в круге: вниз по мусхафу или джузами вверх, внутри джуза всегда сверху вниз. */
export const manzilKey = (meta: MushafMeta, dir: 1 | -1, p: number) => (dir === 1 ? p : (31 - juzOf(meta, p)) * 1000 + p);

/** Группы манзиля по порядку круга: выученное всех джузов, кроме текущего. */
function manzilUnits(s: Learner, meta: MushafMeta, curJuz: number): ManzilUnit[] {
  const halves = s.method.manzilJuz < 1;
  const dir = manzilDir(s);
  const pages = [...learnedOf(s.hifz, meta)].filter(([p]) => juzOf(meta, p) !== curJuz);
  pages.sort(([a], [b]) => manzilKey(meta, dir, a) - manzilKey(meta, dir, b));
  const out: ManzilUnit[] = [];
  for (const [p, spans] of pages) {
    const juz = juzOf(meta, p);
    let half: 1 | 2 | undefined;
    if (halves) {
      const all = juzPages(meta, juz);
      half = all.indexOf(p) < Math.ceil(all.length / 2) ? 1 : 2;
    }
    let unit = out[out.length - 1];
    if (unit?.juz !== juz || unit.half !== half) out.push((unit = { juz, ...(half ? { half } : {}), ranges: [] }));
    unit.ranges.push(...spans.map(([from, to]) => ({ page: p, from, to })));
  }
  return out;
}

type Learner = Pick<Student, "hifz" | "method" | "direction" | "volume">;

/**
 * Делит выученное на сабки и манзиль.
 * Сабки: то, что учится сейчас, страницы текущего джуза, которые сдают пачками по `sabkiPages` (10).
 * Выучено 14 страниц: сдаются первые 10, остальные 4 ждут, пока наберётся ещё 10.
 * Пока в джузе меньше одной полной пачки (новичок), сдают всё, что есть, включая страницы, выученные не целиком.
 * Манзиль: выученное остальных джузов; его сдают по `manzilJuz` джуза за утро, по кругу.
 * Когда выучен весь мусхаф, сабки нет и всё идёт в манзиль.
 */
export function revision(s: Learner, meta: MushafMeta): Revision {
  const m = s.method;
  const place = placeOf(s, meta);
  const curJuz = place ? juzOf(meta, place.page) : 0;
  const learned = learnedOf(s.hifz, meta);
  const full = (p: number): LineRange => ({ page: p, from: 0, to: linesOn(meta, p) });

  const sabki: LineRange[] = [];
  const inCurrent = s.hifz.memorized.filter((p) => juzOf(meta, p) === curJuz);
  const block = Math.max(1, m.sabkiPages);
  const fullBlocks = Math.floor(inCurrent.length / block);
  const recent = fullBlocks > 0 ? inCurrent.slice((fullBlocks - 1) * block, fullBlocks * block) : inCurrent;
  const sabkiWaiting = fullBlocks > 0 ? inCurrent.slice(fullBlocks * block) : [];
  if (fullBlocks === 0 && place) {
    const parts = [...learned].filter(([p]) => juzOf(meta, p) === curJuz && !inCurrent.includes(p));
    for (const [page, spans] of parts) sabki.push(...spans.map(([from, to]) => ({ page, from, to })));
  }
  for (const p of recent) sabki.push(full(p));
  // Сдают подряд, как в мусхафе: по страницам и строкам.
  sabki.sort((a, b) => a.page - b.page || a.from - b.from);

  const units = manzilUnits(s, meta, curJuz);
  let next = 0;
  if (units.length) {
    const at = s.hifz.manzilAt;
    if (at === undefined) next = s.hifz.manzilCursor % units.length;
    else {
      const key = (p: number) => manzilKey(meta, manzilDir(s), p);
      next = units.findIndex((u) => key(u.ranges[u.ranges.length - 1].page) > key(at));
      if (next < 0) next = 0;
    }
  }
  const manzilQueue = [...units.slice(next), ...units.slice(0, next)];
  return { sabki, sabkiWaiting, manzilQueue, manzilToday: manzilQueue.slice(0, manzilPerDay(m)) };
}

/** Сколько групп манзиля за утро. */
export const manzilPerDay = (m: Pick<Method, "manzilJuz">) => (m.manzilJuz > 0 ? Math.max(1, Math.floor(m.manzilJuz)) : 0);

/** Круг по дням, начиная с того, что на очереди. */
export function manzilDays(rev: Revision, m: Pick<Method, "manzilJuz">): ManzilUnit[][] {
  const n = manzilPerDay(m);
  const out: ManzilUnit[][] = [];
  if (n) for (let i = 0; i < rev.manzilQueue.length; i += n) out.push(rev.manzilQueue.slice(i, i + n));
  return out;
}

/** После какой страницы должен идти круг, чтобы следующей стала эта группа. */
export function manzilBefore(queue: ManzilUnit[], unit: ManzilUnit): number {
  const i = queue.findIndex((u) => u.juz === unit.juz && u.half === unit.half);
  const prev = queue[(i - 1 + queue.length) % queue.length];
  return prev.ranges[prev.ranges.length - 1].page;
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

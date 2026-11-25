// Что происходит с прогрессом после сдачи и как сливаются две копии одного ученика. Чистые функции.

import { addRange, learnedOf, nextLesson, withLearned } from "./learned";
import type { DayStats, LineRange, MushafMeta, Student, Submission } from "./types";

const same = (a: LineRange, b: LineRange) => a.page === b.page && a.from === b.from && a.to === b.to;

/** Записывает сдачу в дневник и, если она принята, двигает прогресс. Повторно одна сдача не засчитывается. */
export function settle(s: Student, sub: Submission, groups: number | undefined, meta: MushafMeta): Student {
  if (s.submissions.some((x) => x.id === sub.id)) return s;
  let next: Student = { ...s, submissions: [...s.submissions, sub] };

  if (sub.passed && sub.kind === "nazira") {
    const page = sub.ranges[0].page;
    const read = next.nazira.read.includes(page) ? next.nazira.read : [...next.nazira.read, page];
    next = { ...next, nazira: { next: Math.min(page + 1, meta.pages), read } };
  }

  const p = next.hifz.pending;
  // Учитель мог принять урок, который ученик с тех пор сменил: тогда остаётся только запись в дневнике.
  if (sub.passed && sub.kind === "sabak" && p && same(p, sub.ranges[0])) {
    next = withLearned({ ...next, hifz: { ...next.hifz, pending: null } }, addRange(learnedOf(next.hifz, meta), p), meta);
    const go = nextLesson(next, meta);
    const cur = go ? { page: go.page, line: go.from } : { page: p.page, line: meta.page[p.page - 1][3] };
    next = { ...next, hifz: { ...next.hifz, cur } };
  }

  if (sub.passed && sub.kind === "manzil") {
    const h = next.hifz;
    next = { ...next, hifz: { ...h, manzilCursor: h.manzilCursor + (groups ?? 1), manzilAt: sub.ranges[sub.ranges.length - 1].page } };
  }
  const day: DayStats = next.days[sub.date] ?? { reps: 0, seconds: {}, learned: [] };
  const seconds = { ...day.seconds, [sub.kind]: (day.seconds[sub.kind] ?? 0) + sub.seconds };
  return { ...next, days: { ...next.days, [sub.date]: { ...day, seconds } } };
}

/** Сколько выучено, примерно в строках: этого хватает, чтобы сравнить две копии. */
const amount = (h: Student["hifz"]) =>
  h.memorized.length * 15 + Object.values(h.parts ?? {}).reduce((n, spans) => n + spans.reduce((k, [a, b]) => k + b - a, 0), 0);

const circles = (s: Student) => s.submissions.filter((x) => x.kind === "manzil" && x.passed).length;

/** Какая из двух копий заучивания ушла дальше; при равенстве первая. */
function further(a: Student["hifz"], b: Student["hifz"]): Student["hifz"] {
  const [x, y] = [amount(a), amount(b)];
  if (x !== y) return x > y ? a : b;
  if (a.cur.page !== b.cur.page) return a;
  if (a.cur.line !== b.cur.line) return a.cur.line > b.cur.line ? a : b;
  if (!a.pending !== !b.pending) return a.pending ? a : b;
  if (a.lesson && b.lesson && same(a.lesson.range, b.lesson.range)) {
    const score = (l: NonNullable<Student["hifz"]["lesson"]>) => l.step * 1e6 + l.done * 1e3 + (l.reps ?? 0) / 1e3;
    return score(a.lesson) >= score(b.lesson) ? a : b;
  }
  return a;
}

function mergeDay(a: DayStats | undefined, b: DayStats | undefined): DayStats {
  if (!a || !b) return (a ?? b)!;
  const seconds = { ...b.seconds };
  for (const [k, v] of Object.entries(a.seconds)) {
    const key = k as keyof DayStats["seconds"];
    seconds[key] = Math.max(seconds[key] ?? 0, v ?? 0);
  }
  const learned = [...a.learned, ...b.learned.filter((x) => !a.learned.some((y) => same(x.range, y.range)))];
  return { reps: Math.max(a.reps, b.reps), seconds, learned };
}

/**
 * Одного ученика меняли на двух устройствах без связи. Настройки берутся из более свежей копии,
 * заучивание из той, что ушла дальше, а сдачи и дневник складываются: пропасть ничего не должно.
 */
export function mergeStudents(x: Student, y: Student): Student {
  const [a, b] = (x.updatedAt ?? 0) >= (y.updatedAt ?? 0) ? [x, y] : [y, x];
  const hifz = { ...further(a.hifz, b.hifz), manzilCursor: Math.max(a.hifz.manzilCursor, b.hifz.manzilCursor) };
  // Круг давнего: с того устройства, где его сдавали больше.
  const manzilAt = (circles(b) > circles(a) ? b : a).hifz.manzilAt;
  if (manzilAt !== undefined) hifz.manzilAt = manzilAt;
  else delete hifz.manzilAt;
  const read = [...a.nazira.read, ...b.nazira.read.filter((p) => !a.nazira.read.includes(p))];
  const next = a.nazira.read.length >= b.nazira.read.length ? a.nazira.next : b.nazira.next;
  const submissions = [...a.submissions, ...b.submissions.filter((s) => !a.submissions.some((t) => t.id === s.id))];
  submissions.sort((s, t) => (s.date < t.date ? -1 : s.date > t.date ? 1 : 0));
  const days: Student["days"] = {};
  for (const d of new Set([...Object.keys(a.days), ...Object.keys(b.days)])) days[d] = mergeDay(a.days[d], b.days[d]);
  return { ...a, hifz, nazira: { next, read }, submissions, days };
}

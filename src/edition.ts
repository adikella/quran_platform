// Переход между изданиями мединского мусхафа (1421 и 1441 года).
// Страницы и аяты на них те же, но слова по строкам разбиты по-разному,
// поэтому выученные строки и место урока переносятся по словам, а не по номерам строк.

import { learnedOf, linesOn, withLearned, type Learned, type Span } from "./learned";
import type { MushafId, MushafMeta, PageData, Student } from "./types";

export const EDITIONS: MushafId[] = ["madani1441", "madani"];

export const isEdition = (m: MushafId) => EDITIONS.includes(m);

/** Сколько слов страницы стоит до начала строки `line` (строка = индекс, как в отрезках). */
function wordsBefore(page: PageData, line: number): number {
  return page.l.slice(0, line).reduce((n, l) => n + l.w.length, 0);
}

/** Ближайшая граница строк к слову `words`: так отрезок не растёт и не теряет строку из-за сдвига на слово. */
export function lineAt(page: PageData, words: number): number {
  let best = 0;
  for (let i = 0; i <= page.l.length; i++) {
    if (Math.abs(wordsBefore(page, i) - words) < Math.abs(wordsBefore(page, best) - words)) best = i;
  }
  return best;
}

/** Граница строки страницы в одном издании, перенесённая в другое. */
export function moveLine(line: number, from: PageData, to: PageData): number {
  return lineAt(to, wordsBefore(from, line));
}

/** Страницы, которые нужны для переноса: начатые и текущая. Целые страницы переносятся без данных. */
export function pagesToMove(s: Student, meta: MushafMeta): number[] {
  const learned = learnedOf(s.hifz, meta);
  const partial = [...learned].filter(([p, spans]) => !(spans.length === 1 && spans[0][0] === 0 && spans[0][1] >= linesOn(meta, p)));
  return [...new Set([...partial.map(([p]) => p), s.hifz.cur.page])];
}

/**
 * Ученик в другом издании. `from` и `to`: страницы из `pagesToMove` в старом и новом издании.
 * Урок в работе или запись на проверке не переносим: место в них задано строками старого издания.
 */
export function switchEdition(
  s: Student,
  to: MushafId,
  metaFrom: MushafMeta,
  metaTo: MushafMeta,
  from: Map<number, PageData>,
  next: Map<number, PageData>,
): Student {
  const learned = learnedOf(s.hifz, metaFrom);
  const moved: Learned = new Map();
  for (const [p, spans] of learned) {
    const a = from.get(p);
    const b = next.get(p);
    const whole = spans.length === 1 && spans[0][0] === 0 && spans[0][1] >= linesOn(metaFrom, p);
    if (whole || !a || !b) {
      if (whole) moved.set(p, [[0, linesOn(metaTo, p)]]);
      continue;
    }
    const out: Span[] = spans
      .map(([x, y]): Span => [moveLine(x, a, b), moveLine(y, a, b)])
      .filter(([x, y]) => y > x);
    if (out.length) moved.set(p, out);
  }
  const cur = s.hifz.cur;
  const a = from.get(cur.page);
  const b = next.get(cur.page);
  const line = a && b ? moveLine(cur.line, a, b) : Math.min(cur.line, linesOn(metaTo, cur.page));
  const base: Student = { ...s, mushaf: to, hifz: { ...s.hifz, cur: { page: cur.page, line } } };
  return withLearned(base, moved, metaTo);
}

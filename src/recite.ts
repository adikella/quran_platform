// Сверка распознанного чтения с текстом мусхафа. Чистые функции, проверяются тестами.
//
// По правилу медресе: пропущенное или заменённое слово — ошибка.
// Лишние слова (запнулся, повторил, начал заново) ошибкой не считаются.

/** Убирает огласовку, знаки остановки и приводит буквы к одному виду, чтобы сравнивать слова. */
export function normalizeAr(s: string): string {
  return s
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿـ]/g, "")
    .replace(/[إأآٱٲٳ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ء/g, "")
    .replace(/[^ء-ي]/g, "");
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

/**
 * Насколько слова похожи (0–1). Орфография мусхафа отличается от обычной
 * (الصلوٰة и الصلاة, ٱلرَّحۡمَٰن и الرحمن), поэтому сравнение нестрогое.
 */
export function similarity(a: string, b: string): number {
  const x = normalizeAr(a);
  const y = normalizeAr(b);
  if (!x && !y) return 1;
  const strip = (s: string) => s.replace(/[اوي]/g, "");
  // Долгие гласные в мусхафе часто не пишутся: сравниваем и скелет без них.
  const full = 1 - distance(x, y) / Math.max(x.length, y.length);
  const sx = strip(x);
  const sy = strip(y);
  const skeleton = sx || sy ? 1 - distance(sx, sy) / Math.max(sx.length, sy.length, 1) : 0;
  return Math.max(full, skeleton);
}

export const SAME_WORD = 0.7;

/**
 * Огласовка конца слова: a (фатха, фатхатан), u (дамма, даммтан), i (касра, касратан).
 * null, если в конце слова огласовки нет (сукун, долгая гласная, знак не распознан).
 */
export function finalVowel(word: string): "a" | "u" | "i" | null {
  const marks = word.match(/[\u064B-\u0652]/g);
  if (!marks) return null;
  // Последний знак огласовки, но только если после него нет других букв: «ـُ» в середине слова не считается.
  const tail = word.replace(/[\u0610-\u061A\u06D6-\u06ED\u0670\u0640\s]/g, "");
  const m = tail.match(/([\u064B-\u0652]+)$/);
  if (!m) return null;
  const last = m[1].replace(/\u0651/g, "").slice(-1);
  if (last === "\u064E" || last === "\u064B") return "a";
  if (last === "\u064F" || last === "\u064C") return "u";
  if (last === "\u0650" || last === "\u064D") return "i";
  return null;
}

export type WordVerdict =
  | { status: "ok" }
  | { status: "missed" }
  | { status: "wrong"; heard: string }
  /** Слово то же, но огласовка конца другая (касра вместо даммы и так далее). */
  | { status: "vowel"; heard: string };

export interface Comparison {
  /** Вердикт по каждому слову мусхафа, в том же порядке. */
  words: WordVerdict[];
  /** Сколько лишних слов услышано (повторы, запинки): не ошибка. */
  extra: number;
}

/**
 * Выравнивает услышанные слова с ожидаемыми (как diff).
 * Пропуск ожидаемого слова и замена стоят 1, лишнее услышанное слово дешевле:
 * повтор или начало заново не должны сбивать выравнивание.
 */
export function compareRecitation(expected: string[], heardText: string, pausal: boolean[] = []): Comparison {
  const heard = heardText.split(/\s+/).filter((w) => normalizeAr(w));
  const n = expected.length;
  const m = heard.length;
  const EXTRA = 0.6;
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  const move: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    cost[i][0] = i;
    move[i][0] = 1;
  }
  for (let j = 1; j <= m; j++) {
    cost[0][j] = j * EXTRA;
    move[0][j] = 2;
  }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const sim = similarity(expected[i - 1], heard[j - 1]);
      const pair = cost[i - 1][j - 1] + (sim >= SAME_WORD ? 1 - sim : 1);
      const miss = cost[i - 1][j] + 1;
      const extra = cost[i][j - 1] + EXTRA;
      if (pair <= miss && pair <= extra) {
        cost[i][j] = pair;
        move[i][j] = 0;
      } else if (miss <= extra) {
        cost[i][j] = miss;
        move[i][j] = 1;
      } else {
        cost[i][j] = extra;
        move[i][j] = 2;
      }
    }
  }
  const words: WordVerdict[] = new Array(n);
  let extra = 0;
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const mv = move[i][j];
    if (i > 0 && j > 0 && mv === 0) {
      const sim = similarity(expected[i - 1], heard[j - 1]);
      if (sim < SAME_WORD) words[i - 1] = { status: "wrong", heard: heard[j - 1] };
      else {
        // Конец аята читают с остановкой (вакф), там огласовку не сверяем.
        // На знаках остановки (ۖ ۗ ۚ и другие) чтец тоже может остановиться.
        const stop = pausal[i - 1] || /[\u06D6-\u06DC]/.test(expected[i - 1]);
        const want = stop ? null : finalVowel(expected[i - 1]);
        const got = finalVowel(heard[j - 1]);
        words[i - 1] = want && got && want !== got ? { status: "vowel", heard: heard[j - 1] } : { status: "ok" };
      }
      i--;
      j--;
    } else if (i > 0 && (mv === 1 || j === 0)) {
      words[i - 1] = { status: "missed" };
      i--;
    } else {
      extra++;
      j--;
    }
  }
  return { words, extra };
}

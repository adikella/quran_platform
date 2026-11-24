// Сверка распознанного чтения с текстом мусхафа. Чистые функции, проверяются тестами.
//
// По правилу медресе: пропущенное или заменённое слово — ошибка.
// Лишние слова (запнулся, повторил, начал заново) ошибкой не считаются.

/** Убирает огласовку, знаки остановки и приводит буквы к одному виду, чтобы сравнивать слова. */
export function normalizeAr(s: string): string {
  return s
    .replace(/[ؐ-ًؚ-ٰٟۖ-ۭ࣓-ࣿـ]/g, "")
    .replace(/[إأآٱٲٳ]/g, "ا")
    .replace(/[ىی]/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/[ئء]/g, "")
    .replace(/[^ء-ي]/g, "");
}

/**
 * Как слово мусхафа может быть записано обычной орфографией: надстрочный алиф
 * там то пишется (ٱلۡعَٰلَمِينَ, العالمين), то нет (هَٰذَا, هذا), а وٰ бывает и ا, и وا.
 */
const spellings = new Map<string, string[]>();
function variants(word: string): string[] {
  let v = spellings.get(word);
  if (!v) {
    v = [
      ...new Set([
        normalizeAr(word),
        normalizeAr(word.replace(/ىٰ/g, "ى").replace(/وٰ/g, "ا").replace(/ٰ/g, "ا")),
        normalizeAr(word.replace(/ىٰ/g, "ى").replace(/ٰ/g, "ا")),
      ]),
    ];
    spellings.set(word, v);
  }
  return v;
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

/** Насколько слова похожи (0–1). `expected`: слово мусхафа, `heard`: что услышал ИИ. */
export function similarity(expected: string, heard: string): number {
  const y = normalizeAr(heard);
  let best = 0;
  for (const x of variants(expected)) {
    if (!x && !y) return 1;
    best = Math.max(best, 1 - distance(x, y) / Math.max(x.length, y.length));
  }
  return best;
}

/** С какой похожести слово считается тем же: модель немного ошибается в буквах. */
export const SAME_WORD = 0.7;
/** Слитно и раздельно (يَٰٓأَيُّهَا и «يا أيها»): только при почти полном совпадении, чтобы не скрыть пропуск. */
const SAME_JOINED = 0.9;

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
      // Одно слово мусхафа записано двумя словами.
      if (j > 1) {
        const sim2 = similarity(expected[i - 1], heard[j - 2] + heard[j - 1]);
        const c = cost[i - 1][j - 2] + 1 - sim2 + 0.05;
        if (sim2 >= SAME_JOINED && c < cost[i][j]) {
          cost[i][j] = c;
          move[i][j] = 3;
        }
      }
      // Васль: لَا ٱنفِصَامَ звучит как «لن فصام», граница слов сдвинута.
      if (i > 1 && j > 1 && expected[i - 1].startsWith("ٱ")) {
        const joined = normalizeAr(expected[i - 2]).replace(/[اوي]$/, "") + normalizeAr(expected[i - 1]).slice(1);
        const heard2 = normalizeAr(heard[j - 2] + heard[j - 1]);
        const c = cost[i - 2][j - 2] + 0.05;
        if (joined === heard2 && c < cost[i][j]) {
          cost[i][j] = c;
          move[i][j] = 5;
        }
      }
      // Два слова мусхафа записаны одним.
      if (i > 1) {
        const sim2 = similarity(expected[i - 2] + expected[i - 1], heard[j - 1]);
        const c = cost[i - 2][j - 1] + 1 - sim2 + 0.05;
        if (sim2 >= SAME_JOINED && c < cost[i][j]) {
          cost[i][j] = c;
          move[i][j] = 4;
        }
      }
    }
  }
  const words: WordVerdict[] = new Array(n);
  let extra = 0;
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    const mv = move[i][j];
    if (mv >= 3) {
      words[i - 1] = { status: "ok" };
      if (mv !== 3) words[i - 2] = { status: "ok" };
      i -= mv === 3 ? 1 : 2;
      j -= mv === 4 ? 1 : 2;
    } else if (i > 0 && j > 0 && mv === 0) {
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

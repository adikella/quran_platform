// Материалы к аятам из открытого API приложения «Сура» (dev.surahapp.com): тафсир, таджвид, кырааты,
// иъраб, польза страницы, достоинства сур. Всё на арабском. Берём прямо у них (сервер разрешает
// запросы с любых сайтов), к себе не копируем.

const API = "https://dev.surahapp.com/api/v1";

export type Topic = "fawaed" | "mokhtasar" | "tajweed" | "nozool" | "qeraat" | "eerab" | "saadi" | "fadael";

/** Отрывок для показа: к какому аяту (или слову) и текст. */
export interface Note {
  sura: number;
  aya: number;
  /** Последний аят, если одно пояснение на несколько аятов подряд. */
  to?: number;
  word?: string;
  text: string;
}

/** Одно и то же пояснение у соседних аятов (у них так бывает) показываем один раз: «1–2». */
function mergeSame(list: Note[]): Note[] {
  const out: Note[] = [];
  for (const n of list) {
    const last = out[out.length - 1];
    if (last && !n.word && last.sura === n.sura && last.text === n.text && (last.to ?? last.aya) + 1 === n.aya) last.to = n.aya;
    else out.push({ ...n });
  }
  return out;
}

const cache = new Map<string, Promise<unknown>>();

function get<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(`${API}${path}`).then(async (r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`);
      return r.json() as Promise<T>;
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

/** Аяты страницы, сгруппированные по сурам: [[11, 6, 12]]. */
export function ayahRuns(verses: string[]): [number, number, number][] {
  const runs: [number, number, number][] = [];
  for (const v of verses) {
    const [s, a] = v.split(":").map(Number);
    const last = runs[runs.length - 1];
    if (last && last[0] === s) last[2] = a;
    else runs.push([s, a, a]);
  }
  return runs;
}

interface AyaRow {
  content: string;
  sura_number: number;
  aya_number: number;
}
interface WordRow extends AyaRow {
  word_number: number;
  word: string;
}

const AYA_SLUG: Partial<Record<Topic, string>> = {
  mokhtasar: "tafsir-mokhtasar",
  tajweed: "tajweed-aya",
  eerab: "eerab-aya",
  saadi: "tafsir-saadi",
};

/** Материал по теме для аятов страницы (verses: ключи аятов «11:6»). */
export async function notes(topic: Topic, page: number, verses: string[]): Promise<Note[]> {
  const runs = ayahRuns(verses);
  if (topic === "fawaed") {
    const r = await get<{ content: string[] }>(`/page/fawaed-page/${page}`);
    return r.content.map((text) => ({ sura: runs[0][0], aya: runs[0][1], text }));
  }
  if (topic === "fadael") {
    const out: Note[] = [];
    for (const [s] of runs) {
      try {
        const r = await get<{ content: string }>(`/sura/fadael-sowar/${s}`);
        out.push({ sura: s, aya: 0, text: r.content });
      } catch {
        /* у суры нет отдельной главы о достоинствах */
      }
    }
    return out;
  }
  if (topic === "qeraat") {
    const all = await Promise.all(
      runs.flatMap(([s, a, b]) =>
        Array.from({ length: b - a + 1 }, (_, i) => get<WordRow[]>(`/word/word-qeraat/${s}/${a + i}/1/300`).catch(() => [])),
      ),
    );
    // Слова, где все чтецы читают одинаково, не показываем.
    return all
      .flat()
      .filter((w) => !/^لا خلاف بين القراء في هذا الموضع\s*(\n---\{عند الوصل\}---\nلا خلاف بين القراء في هذا الموضع)?\s*$/.test(w.content.trim()))
      .map((w) => ({ sura: w.sura_number, aya: w.aya_number, word: w.word, text: w.content }));
  }
  if (topic === "nozool") {
    // Причины ниспослания есть не у каждого аята, а запрос на несколько аятов падает, если у первого её нет:
    // спрашиваем по аяту.
    const rows = await Promise.all(
      runs.flatMap(([s, a, b]) =>
        Array.from({ length: b - a + 1 }, (_, i) => get<AyaRow>(`/aya/ayat-nozool/${s}/${a + i}`).catch(() => null)),
      ),
    );
    return mergeSame(
      rows.filter((r): r is AyaRow => !!r?.content).map((r) => ({ sura: r.sura_number, aya: r.aya_number, text: r.content })),
    );
  }
  const slug = AYA_SLUG[topic]!;
  const rows = await Promise.all(
    runs.map(([s, a, b]) => get<AyaRow[] | AyaRow>(a === b ? `/aya/${slug}/${s}/${a}` : `/aya/${slug}/${s}/${a}/${b}`).catch(() => [])),
  );
  return mergeSame(
    rows
      .flatMap((r) => (Array.isArray(r) ? r : [r]))
      .filter((r) => r.content)
      .map((r) => ({ sura: r.sura_number, aya: r.aya_number, text: r.content })),
  );
}

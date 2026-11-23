// Скачивает разметку страниц двух мусхафов (мединский и пакистанский 15-строчный)
// из API quran.com и сохраняет в public/data/<mushaf>/.
//
//   node scripts/fetch-mushaf.mjs            — оба мусхафа
//   node scripts/fetch-mushaf.mjs madani     — только один
//
// Формат страницы (p<chunk>.json хранит 20 страниц подряд):
//   { p: номер, j: джуз, v: ["2:142", ...] — аяты страницы по порядку,
//     l: [{ n: номер строки, f: индекс в v, с которого начинается строка,
//           w: ["слово", ..., 142 (число = конец аята), ...] }] }

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.quran.com/api";

const MUSHAFS = {
  madani: { id: 5, pages: 604, field: "text_qpc_hafs" },
  indopak: { id: 6, pages: 610, field: "text_indopak" },
};

const CHUNK = 20;

async function getJson(url, tries = 5) {
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i >= tries - 1) throw new Error(`${url}: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
}

async function fetchPage(mushaf, page) {
  const { id, field } = MUSHAFS[mushaf];
  const url =
    `${API}/qdc/verses/by_page/${page}?words=true&per_page=100&mushaf=${id}` +
    `&word_fields=line_number,page_number,${field}&fields=juz_number`;
  const data = await getJson(url);
  const verses = data.verses;
  if (!verses?.length) throw new Error(`${mushaf} p${page}: пустая страница`);

  const v = verses.map((x) => x.verse_key);
  const lines = new Map();
  verses.forEach((verse, vi) => {
    for (const w of verse.words) {
      if (w.page_number !== page) continue;
      let line = lines.get(w.line_number);
      if (!line) {
        line = { n: w.line_number, f: vi, w: [] };
        lines.set(w.line_number, line);
      }
      if (w.char_type_name === "end") {
        line.w.push(Number(verse.verse_key.split(":")[1]));
      } else if (w.char_type_name === "word") {
        // Убираем невидимые служебные символы (U+200B, U+FEFF): шрифты рисуют их квадратиками.
        const text = (w[field] ?? w.text).replace(/[\u200B\uFEFF]/g, "").trim();
        if (text) line.w.push(text);
      }
    }
  });
  const l = [...lines.values()].sort((a, b) => a.n - b.n);
  return { p: page, j: verses[0].juz_number, v, l };
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function fetchMushaf(mushaf) {
  const { pages } = MUSHAFS[mushaf];
  const dir = join(ROOT, "public", "data", mushaf);
  await mkdir(dir, { recursive: true });

  let done = 0;
  const all = await pool(
    Array.from({ length: pages }, (_, i) => i + 1),
    6,
    async (p) => {
      const page = await fetchPage(mushaf, p);
      if (++done % 50 === 0) console.log(`${mushaf}: ${done}/${pages}`);
      return page;
    },
  );

  for (let c = 0; c * CHUNK < pages; c++) {
    const slice = all.slice(c * CHUNK, (c + 1) * CHUNK);
    await writeFile(join(dir, `p${c}.json`), JSON.stringify(slice));
  }

  // Краткие сведения о каждой странице: джуз, первый и последний аят, число строк.
  const meta = {
    mushaf,
    pages,
    chunk: CHUNK,
    page: all.map((pg) => [pg.j, pg.v[0], pg.v[pg.v.length - 1], pg.l.length]),
  };
  await writeFile(join(dir, "meta.json"), JSON.stringify(meta));
  console.log(`${mushaf}: готово, ${pages} страниц`);
}

async function fetchSurahs() {
  const langs = ["ru", "en", "kk", "ar"];
  const byLang = {};
  for (const lang of langs) {
    byLang[lang] = (await getJson(`${API}/v4/chapters?language=${lang}`)).chapters;
  }
  const surahs = byLang.en.map((c, i) => ({
    n: c.id,
    ar: c.name_arabic,
    tr: c.name_simple,
    ayahs: c.verses_count,
    basmala: c.bismillah_pre,
    t: Object.fromEntries(langs.map((lg) => [lg, byLang[lg][i].translated_name.name])),
  }));
  // Казахских названий в API нет (приходят английские), поэтому берём русские.
  for (const s of surahs) if (s.t.kk === s.t.en) s.t.kk = s.t.ru;
  await writeFile(join(ROOT, "public", "data", "surahs.json"), JSON.stringify(surahs));
  console.log("surahs.json: готово");
}

const which = process.argv.slice(2);
const targets = which.length ? which : Object.keys(MUSHAFS);
await fetchSurahs();
for (const m of targets) await fetchMushaf(m);

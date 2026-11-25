// Скачивает разметку страниц двух мусхафов (мединский и пакистанский 15-строчный)
// из API quran.com и сохраняет в public/data/<mushaf>/.
//
//   node scripts/fetch-mushaf.mjs            — оба мусхафа
//   node scripts/fetch-mushaf.mjs madani     — только один
//   node scripts/fetch-mushaf.mjs meta       — пересобрать meta.json из скачанных страниц
//
// Формат страницы (p<chunk>.json хранит 20 страниц подряд):
//   { p: номер, j: джуз, r: номер четверти хизба (1–240) на начало страницы, v: ["2:142", ...] — аяты страницы по порядку,
//     l: [{ n: номер строки, f: индекс в v, с которого начинается строка,
//           w: ["слово", ..., 142 (число = конец аята), ...] }] }

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://api.quran.com/api";

const MUSHAFS = {
  madani: { id: 5, pages: 604, field: "text_qpc_hafs", glyphs: true },
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
  const { id, field, glyphs } = MUSHAFS[mushaf];
  const url =
    `${API}/qdc/verses/by_page/${page}?words=true&per_page=100&mushaf=${id}` +
    `&word_fields=line_number,page_number,${field}${glyphs ? ",code_v2,v2_page" : ""}&fields=juz_number,rub_el_hizb_number`;
  const data = await getJson(url);
  const verses = data.verses;
  if (!verses?.length) throw new Error(`${mushaf} p${page}: пустая страница`);

  const v = verses.map((x) => x.verse_key);
  const lines = new Map();
  verses.forEach((verse, vi) => {
    for (const w of verse.words) {
      if (w.page_number !== page) continue;
      if (glyphs && w.v2_page !== page) console.warn(`${mushaf} p${page}: слово из шрифта страницы ${w.v2_page}`);
      let line = lines.get(w.line_number);
      if (!line) {
        line = { n: w.line_number, f: vi, w: [], ...(glyphs ? { c: [] } : {}) };
        lines.set(w.line_number, line);
      }
      if (w.char_type_name === "end") {
        line.w.push(Number(verse.verse_key.split(":")[1]));
        if (glyphs) line.c.push(w.code_v2);
      } else if (w.char_type_name === "word") {
        // Убираем невидимые служебные символы (U+200B, U+FEFF): шрифты рисуют их квадратиками.
        const text = (w[field] ?? w.text).replace(/[\u200B\uFEFF]/g, "").trim();
        if (text) {
          line.w.push(text);
          if (glyphs) line.c.push(w.code_v2);
        }
      }
    }
  });
  const l = [...lines.values()].sort((a, b) => a.n - b.n);
  return { p: page, j: verses[0].juz_number, r: verses[0].rub_el_hizb_number, v, l };
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

  await writeMeta(mushaf, all);
  console.log(`${mushaf}: готово, ${pages} страниц`);
}

/** Где в строке кончается аят: "2" строка кончается концом аята, "1" аят кончается посреди строки, "0" нет. */
function ayahEnds(pg) {
  return pg.l
    .map((l) => (typeof l.w[l.w.length - 1] === "number" ? "2" : l.w.some((x) => typeof x === "number") ? "1" : "0"))
    .join("");
}

/** Где начинается каждая сура: [страница, строка]. Если сура начинается посреди строки, берётся следующая строка. */
function surahStarts(all) {
  const out = [];
  for (const pg of all) {
    pg.l.forEach((line, li) => {
      let vi = line.f;
      line.w.forEach((w, wi) => {
        const [s, a] = pg.v[Math.min(vi, pg.v.length - 1)].split(":").map(Number);
        if (a === 1 && !out[s - 1] && (wi === 0 || typeof line.w[wi - 1] === "number")) {
          out[s - 1] = wi === 0 ? [pg.p, li] : li + 1 < pg.l.length ? [pg.p, li + 1] : [pg.p + 1, 0];
        }
        if (typeof w === "number") vi++;
      });
    });
  }
  return out;
}

// Краткие сведения о каждой странице: джуз, первый и последний аят, число строк, концы аятов по строкам.
async function writeMeta(mushaf, all) {
  const meta = {
    mushaf,
    pages: all.length,
    chunk: CHUNK,
    page: all.map((pg) => [pg.j, pg.v[0], pg.v[pg.v.length - 1], pg.l.length, ayahEnds(pg)]),
    surah: surahStarts(all),
  };
  await writeFile(join(ROOT, "public", "data", mushaf, "meta.json"), JSON.stringify(meta));
}

/** Пересобрать meta.json из уже скачанных страниц, без сети. */
async function rebuildMeta(mushaf) {
  const dir = join(ROOT, "public", "data", mushaf);
  const all = [];
  for (let c = 0; existsSync(join(dir, `p${c}.json`)); c++) all.push(...JSON.parse(await readFile(join(dir, `p${c}.json`), "utf8")));
  await writeMeta(mushaf, all);
  console.log(`${mushaf}: meta.json пересобран`);
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

// Постраничные шрифты QCF (Комплекс короля Фахда): по одному файлу на страницу мединского мусхафа.
// Каждое слово страницы хранится в данных как код глифа (поле c) и рисуется своим шрифтом.
const FONT_URL = (p) => `https://verses.quran.foundation/fonts/quran/hafs/v2/woff2/p${p}.woff2`;

async function fetchFonts() {
  const dir = join(ROOT, "public", "fonts", "qcf2");
  await mkdir(dir, { recursive: true });
  const pages = Array.from({ length: MUSHAFS.madani.pages }, (_, i) => i + 1);
  let done = 0;
  await pool(pages, 6, async (p) => {
    const file = join(dir, `p${p}.woff2`);
    if (!existsSync(file)) {
      for (let i = 0; ; i++) {
        try {
          const res = await fetch(FONT_URL(p));
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await writeFile(file, Buffer.from(await res.arrayBuffer()));
          break;
        } catch (err) {
          if (i >= 4) throw new Error(`шрифт p${p}: ${err.message}`);
          await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
        }
      }
    }
    if (++done % 100 === 0) console.log(`шрифты: ${done}/${pages.length}`);
  });
  console.log("шрифты QCF: готово");
}

const which = process.argv.slice(2);
if (which.includes("fonts")) {
  await fetchFonts();
} else if (which.includes("meta")) {
  for (const m of Object.keys(MUSHAFS)) await rebuildMeta(m);
} else {
  const targets = which.length ? which : Object.keys(MUSHAFS);
  await fetchSurahs();
  for (const m of targets) await fetchMushaf(m);
  if (targets.includes("madani")) await fetchFonts();
}

// Мединский мусхаф издания 1441 года (шрифт QCF4) из открытого пакета quran-qcf4.
//
//   node scripts/build-1441.mjs
//
// Слова (текст с огласовкой и концы аятов) берём из нашего мединского мусхафа 1421 года:
// текст тот же, по нему сверяется чтение. Из пакета берём только разбивку на строки,
// коды глифов и шрифт страницы. Данные пакета под лицензией MIT.
//
// Сами шрифты к себе не кладём: их можно использовать для показа Корана, но не распространять.
// Приложение берёт их с jsDelivr, из того же пакета той же версии (см. QCF4_FONTS в PageView).
//
// Формат страницы как у madani, плюс:
//   font: имя шрифта страницы (QCF4_Hafs_17), один файл на 13 страниц;
//   hd: { [сура]: [глиф рамки с названием, глиф басмалы или ""] } для сур, начинающихся на странице.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const QCF4_VERSION = "1.1.0";
const TGZ = `https://registry.npmjs.org/quran-qcf4/-/quran-qcf4-${QCF4_VERSION}.tgz`;
const CHUNK = 20;
const PAGES = 604;

async function unpack() {
  const dir = join(tmpdir(), `quran-qcf4-${QCF4_VERSION}`);
  if (existsSync(join(dir, "package", "pages", "604.json"))) return join(dir, "package");
  await mkdir(dir, { recursive: true });
  const res = await fetch(TGZ);
  if (!res.ok) throw new Error(`${TGZ}: HTTP ${res.status}`);
  const file = join(dir, "pkg.tgz");
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  execFileSync("tar", ["-xzf", file, "-C", dir]);
  return join(dir, "package");
}

async function ours() {
  const all = [];
  for (let c = 0; c * CHUNK < PAGES; c++) {
    all.push(...JSON.parse(await readFile(join(ROOT, "public", "data", "madani", `p${c}.json`), "utf8")));
  }
  return all;
}

/** Слова страницы 1421 года подряд, с аятом каждого. */
/** Сколько знаков у каждого аята страницы в 1441 (без отдельного знака поклона). */
function v4Counts(v4) {
  const n = {};
  for (const l of v4.lines) {
    for (const x of l.words) {
      if ((x.type === "word" || x.type === "end") && !x.text.startsWith("#")) n[x.verse_key] = (n[x.verse_key] ?? 0) + 1;
    }
  }
  return n;
}

/** Слова страницы 1421 года подряд, с аятом каждого. */
function flatten(pg, v4) {
  const want = v4Counts(v4);
  const have = {};
  for (const line of pg.l) {
    let vi = line.f;
    for (const w of line.w) {
      have[pg.v[vi]] = (have[pg.v[vi]] ?? 0) + 1;
      if (typeof w === "number") vi++;
    }
  }
  const out = [];
  for (const line of pg.l) {
    let vi = line.f;
    for (const w of line.w) {
      const verse = pg.v[vi];
      // «بَعۡدَ مَا» у нас одно слово, а в 1441 два знака: делим, только если в этом аяте 1441 знаков больше.
      const split = typeof w === "string" && w.includes(" ") && want[verse] > have[verse];
      for (const x of split ? w.split(" ").filter(Boolean) : [w]) out.push({ w: x, verse });
      if (typeof w === "number") vi++;
    }
  }
  return out;
}

function build(pg, v4) {
  const tokens = flatten(pg, v4);
  const lines = [];
  const hd = {};
  let i = 0;
  let quarter = "";
  for (const l of v4.lines) {
    const header = l.words.find((x) => x.type === "surah_header");
    if (header) {
      hd[header.sura] = [header.char, ""];
      continue;
    }
    const basmala = l.words.find((x) => x.type === "bismillah");
    if (basmala) {
      const s = Object.keys(hd).at(-1);
      if (!s) throw new Error(`p${pg.p}: басмала без названия суры`);
      hd[s][1] = basmala.char;
      continue;
    }
    const line = { n: lines.length + 1, f: -1, w: [], c: [] };
    for (const x of l.words) {
      // Знак четверти хизба (۞) в нашем тексте не отдельное слово: рисуем его вместе со следующим, справа от него.
      if (x.type === "quarter") {
        quarter += x.char;
        continue;
      }
      if (x.type !== "word" && x.type !== "end") throw new Error(`p${pg.p}: неизвестный знак ${x.type}`);
      // Знак земного поклона (۩) в 1441 отдельный, у нас он часть слова: рисуем вместе с предыдущим.
      if (x.text.startsWith("#")) {
        if (!line.c.length) throw new Error(`p${pg.p}: знак поклона в начале строки`);
        // Глифы шрифта идут слева направо, поэтому знак, который читается после слова, ставим перед ним.
        line.c[line.c.length - 1] = x.char + line.c[line.c.length - 1];
        continue;
      }
      const t = tokens[i++];
      if (!t) throw new Error(`p${pg.p}: в 1441 слов больше`);
      const isEnd = typeof t.w === "number";
      if (isEnd !== (x.type === "end") || t.verse !== x.verse_key) {
        throw new Error(`p${pg.p}: слово ${i} не совпадает: ${t.w} ${t.verse} и ${x.type} ${x.verse_key}`);
      }
      if (line.f < 0) line.f = pg.v.indexOf(t.verse);
      line.w.push(t.w);
      line.c.push(x.char + quarter);
      quarter = "";
    }
    if (line.w.length) lines.push(line);
  }
  if (i !== tokens.length) throw new Error(`p${pg.p}: в 1421 слов больше (${tokens.length} и ${i})`);
  return { p: pg.p, j: pg.j, r: pg.r, v: pg.v, font: v4.font, hd, l: lines };
}

function ayahEnds(pg) {
  return pg.l
    .map((l) => (typeof l.w[l.w.length - 1] === "number" ? "2" : l.w.some((x) => typeof x === "number") ? "1" : "0"))
    .join("");
}

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

const pkg = await unpack();
const old = await ours();
const all = [];
let moved = 0;
for (const pg of old) {
  const v4 = JSON.parse(await readFile(join(pkg, "pages", `${String(pg.p).padStart(3, "0")}.json`), "utf8"));
  const next = build(pg, v4);
  if (next.l.length !== pg.l.length || next.l.some((l, i) => l.w.length !== pg.l[i].w.length)) moved++;
  all.push(next);
}
const dir = join(ROOT, "public", "data", "madani1441");
await mkdir(dir, { recursive: true });
for (let c = 0; c * CHUNK < PAGES; c++) await writeFile(join(dir, `p${c}.json`), JSON.stringify(all.slice(c * CHUNK, (c + 1) * CHUNK)));
const meta = {
  mushaf: "madani1441",
  pages: PAGES,
  chunk: CHUNK,
  page: all.map((pg) => [pg.j, pg.v[0], pg.v[pg.v.length - 1], pg.l.length, ayahEnds(pg)]),
  surah: surahStarts(all),
};
await writeFile(join(dir, "meta.json"), JSON.stringify(meta));
console.log(`madani1441: готово, ${PAGES} страниц, разбивка строк отличается от 1421 на ${moved}`);

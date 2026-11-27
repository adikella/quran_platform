import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../hooks";
import { Icon } from "../icons";
import { surahName, verseSpanLabel } from "../mushaf";
import type { Lang, MushafMeta, Surah } from "../types";

type Tab = "surah" | "juz" | "page";

/** Номер суры, в которой стоит страница (сура, начавшаяся последней до этой страницы). */
export function surahOfPage(meta: MushafMeta, page: number): number {
  const [s] = meta.page[page - 1][1].split(":").map(Number);
  return s;
}

/** Без огласовки, дефисов и апострофов: «аль-фатиха», «Al-Fatihah» и «fatiha» находятся одинаково. */
function plain(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[ً-ٰٟۖ-ۭ̀-ͯ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/[^a-zа-яёәіңғүұқөһء-ي0-9]/g, "");
}

/** Содержание мусхафа: суры, джузы и страницы, с поиском суры. */
export function MushafIndex({
  meta,
  surahs,
  lang,
  page,
  onPick,
  onClose,
}: {
  meta: MushafMeta;
  surahs: Surah[];
  lang: Lang;
  page: number;
  onPick: (p: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [tab, setTab] = useState<Tab>("surah");
  const [q, setQ] = useState("");
  const [target, setTarget] = useState(page);
  const list = useRef<HTMLDivElement>(null);
  const current = surahOfPage(meta, page);
  const juzNow = meta.page[page - 1][0];

  const found = useMemo(() => {
    const k = plain(q);
    if (!k) return surahs;
    return surahs.filter((s) => String(s.n) === k || [s.tr, s.ar, ...Object.values(s.t)].some((x) => plain(x).includes(k)));
  }, [q, surahs]);

  const juzStarts = useMemo(() => {
    const out: { juz: number; page: number; verse: string }[] = [];
    meta.page.forEach(([j, first], i) => {
      if (!out.some((x) => x.juz === j)) out.push({ juz: j, page: i + 1, verse: first });
    });
    return out;
  }, [meta]);

  // Открылось: текущая сура или джуз сразу на виду.
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[data-now]")?.scrollIntoView({ block: "center" });
  }, [tab]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const pick = (p: number) => {
    onPick(Math.max(1, Math.min(meta.pages, p)));
    onClose();
  };

  return (
    <div className="index-sheet" role="dialog" aria-modal="true" aria-label={t("idx_title")}>
      <header className="index-head">
        <h2>{t("idx_title")}</h2>
        <button className="ghost small icon-btn" onClick={onClose} aria-label={t("idx_close")}>
          <Icon name="close" size={20} />
        </button>
      </header>

      <div className="index-tabs" role="tablist">
        {(["surah", "juz", "page"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            {t(`idx_${k}`)}
          </button>
        ))}
      </div>

      {tab === "surah" && (
        <label className="index-search">
          <Icon name="search" size={18} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("idx_search")} aria-label={t("idx_search")} />
        </label>
      )}

      <div className="index-list" ref={list}>
        {tab === "surah" &&
          (found.length ? (
            found.map((s) => {
              const start = meta.surah[s.n - 1][0];
              const now = s.n === current;
              return (
                <button key={s.n} className={`index-row ${now ? "here" : ""}`} data-now={now || undefined} onClick={() => pick(start)}>
                  <span className="index-num">{s.n}</span>
                  <span className="index-name">
                    <b>{surahName(s, lang)}</b>
                    <small>{t("idx_ayahs", { n: s.ayahs, p: start })}</small>
                  </span>
                  {lang !== "ar" && (
                    <span className="index-ar" lang="ar">
                      {s.ar}
                    </span>
                  )}
                </button>
              );
            })
          ) : (
            <p className="muted center">{t("idx_none")}</p>
          ))}

        {tab === "juz" &&
          juzStarts.map(({ juz, page: p, verse }) => {
            const now = juz === juzNow;
            return (
              <button key={juz} className={`index-row ${now ? "here" : ""}`} data-now={now || undefined} onClick={() => pick(p)}>
                <span className="index-num">{juz}</span>
                <span className="index-name">
                  <b>
                    {t("idx_juz")} {juz}
                  </b>
                  <small>{t("idx_juzFrom", { v: verseSpanLabel(verse, verse, surahs, lang), p })}</small>
                </span>
              </button>
            );
          })}

        {tab === "page" && (
          <div className="index-page">
            <div className="index-page-num">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={meta.pages}
                value={target}
                onChange={(e) => setTarget(Math.max(1, Math.min(meta.pages, Number(e.target.value) || 1)))}
                aria-label={t("idx_page")}
              />
              <span className="muted">
                {verseSpanLabel(meta.page[target - 1][1], meta.page[target - 1][2], surahs, lang)}
              </span>
            </div>
            <input
              type="range"
              className="index-range"
              min={1}
              max={meta.pages}
              value={target}
              onChange={(e) => setTarget(Number(e.target.value))}
              aria-label={t("idx_page")}
            />
            <div className="index-range-ends">
              <span>1</span>
              <span>{meta.pages}</span>
            </div>
            <button className="wide" onClick={() => pick(target)}>
              {t("idx_open")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

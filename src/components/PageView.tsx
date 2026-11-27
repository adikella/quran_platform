import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../hooks";
import { arabicDigits, surahStarts } from "../mushaf";
import type { MushafId, PageData, Surah } from "../types";

export type WordMark = 1 | 2; // 1 — ошибка, 2 — замечание по таджвиду

interface Props {
  mushaf: MushafId;
  page: PageData;
  surahs: Surah[];
  /** Строки [from, to), с которыми сейчас работаем; остальные приглушены. */
  active?: [number, number];
  /** Скрыть активные строки (наизусть). */
  hidden?: boolean;
  /** Показать скрытое, пока зажата кнопка «Подсмотреть». */
  peek?: boolean;
  /** Показать только активные строки. */
  onlyActive?: boolean;
  marks?: Record<string, WordMark>;
  onWord?: (key: string) => void;
  /** Кнопка закладки в шапке страницы. */
  bookmark?: { on: boolean; toggle: () => void };
  /** Сколько первых слов строки после активных учить заодно, чтобы связать с завтрашним уроком. */
  bridge?: number;
  /** Вся страница на экран без прокрутки, как в мусхафе: 15 рядов, высота ряда по высоте экрана. */
  fill?: boolean;
}

/**
 * Подбирает размер шрифта так, чтобы самая длинная строка помещалась по ширине:
 * строки мусхафа нельзя переносить, иначе номера строк перестанут совпадать с бумажным мусхафом.
 */
function useFitLines(key: string, fill = false) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const fit = () => {
      // Ставим заведомо крупный шрифт: самая длинная строка переполняется,
      // и по её ширине находим размер, при котором она занимает страницу целиком.
      // Так остальные строки отличаются от неё мало, и пробелы между словами остаются ровными.
      const probe = 80;
      el.style.fontSize = `${probe}px`;
      const lines = [...el.querySelectorAll<HTMLElement>(".line")];
      lines.forEach((line) => delete line.dataset.short);
      // Естественная ширина строки при пробном шрифте: слова плюс промежутки между ними.
      const natural = lines.map((line) => {
        const kids = [...line.children] as HTMLElement[];
        const gap = parseFloat(getComputedStyle(line).columnGap) || 0;
        return kids.reduce((sum, k) => sum + k.getBoundingClientRect().width, 0) + gap * Math.max(0, kids.length - 1);
      });
      let ratio = 0;
      lines.forEach((line, i) => {
        if (line.clientWidth) ratio = Math.max(ratio, natural[i] / line.clientWidth);
      });
      if (ratio > 0) {
        const size = Math.min(44, Math.floor((probe / ratio) * 0.985 * 10) / 10);
        el.style.fontSize = `${size}px`;
        // Короткие строки (концы сур, страницы 1 и 2) не растягиваем, а ставим по центру, как в бумажном мусхафе.
        lines.forEach((line, i) => {
          if (natural[i] * (size / probe) < line.clientWidth * 0.8) line.dataset.short = "1";
          else delete line.dataset.short;
        });
      } else {
        el.style.fontSize = "";
      }
      if (fill && ratio > 0) fitHeight(el, lines.length);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fit();
    document.fonts?.ready.then(schedule);
    // Подгоняем заново только при смене ширины: высота меняется от самой подгонки.
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth !== width) {
        width = el.clientWidth;
        schedule();
      }
    });
    ro.observe(el);
    // Высота экрана меняется отдельно от ширины (поворот, панель Телеграма).
    let height = window.innerHeight;
    const onResize = () => {
      if (fill && window.innerHeight !== height) {
        height = window.innerHeight;
        schedule();
      }
    };
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(frame);
    };
  }, [key, fill]);
  return ref;
}

/** Самый просторный ряд и самый тесный, в долях размера шрифта. */
const ROW_MAX = 2.3;
const ROW_MIN = 1.62;

/**
 * Ряд страницы (строка текста, название суры или басмала) одной высоты, как в бумажном мусхафе:
 * у мединского их всегда 15. Высоту ряда берём так, чтобы страница встала на экран целиком;
 * если и при тесных рядах не влезает, уменьшаем шрифт.
 */
function fitHeight(el: HTMLElement, textLines: number) {
  const rows = textLines + el.querySelectorAll(".surah-title, .basmala").length;
  const font = parseFloat(el.style.fontSize) || 20;
  const cs = getComputedStyle(el);
  const head = el.querySelector<HTMLElement>(".page-head")?.offsetHeight ?? 0;
  const tabs = document.querySelector<HTMLElement>(".tabs")?.offsetHeight ?? 0;
  const top = el.getBoundingClientRect().top + window.scrollY;
  const free = window.innerHeight - tabs - top - head - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 6;
  let row = Math.min(font * ROW_MAX, free / rows);
  if (row < font * ROW_MIN) {
    el.style.fontSize = `${Math.floor((row / ROW_MIN) * 10) / 10}px`;
    row = Math.max(row, 18);
  }
  el.style.setProperty("--row", `${Math.floor(row * 10) / 10}px`);
  el.classList.add("rows");
}

const BASE = import.meta.env.BASE_URL;
const qcfLoaded = new Map<number, Promise<boolean>>();

/** Подгружает шрифт QCF страницы (мединский мусхаф). Пока шрифт не готов, возвращает false. */
function useQcfFont(page: number, needed: boolean) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!needed) return;
    let alive = true;
    let p = qcfLoaded.get(page);
    if (!p) {
      const face = new FontFace(`QCF${page}`, `url(${BASE}fonts/qcf2/p${page}.woff2) format("woff2")`);
      p = face.load().then(
        (f) => {
          document.fonts.add(f);
          return true;
        },
        () => false,
      );
      qcfLoaded.set(page, p);
    }
    setReady(false);
    p.then((ok) => alive && setReady(ok));
    return () => {
      alive = false;
    };
  }, [page, needed]);
  return ready;
}

const BASMALA = "بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ";

export function PageView({ mushaf, page, surahs, active, hidden, peek, onlyActive, marks, onWord, bookmark, bridge, fill }: Props) {
  const t = useT();
  const starts = surahStarts(page);
  const glyphs = mushaf === "madani" && page.l.every((l) => l.c);
  const qcfReady = useQcfFont(page.p, glyphs);
  const useGlyphs = glyphs && qcfReady;
  const ref = useFitLines([page.p, mushaf, onlyActive, active?.[0], active?.[1], useGlyphs].join("|"), fill);
  const surahNo = Number(page.v[0].split(":")[0]);
  const showHead = !active && !onlyActive;
  return (
    <div
      ref={ref}
      className={`page page-${mushaf} ${useGlyphs ? "qcf" : ""}`}
      style={useGlyphs ? { fontFamily: `"QCF${page.p}"` } : undefined}
      dir="rtl"
      lang="ar"
    >
      {showHead && (
        <div className="page-head">
          <span>
            {arabicDigits(surahNo)} {surahs[surahNo - 1]?.ar.replace(/^سورة\s*/, "") ?? ""}
            {surahs[surahNo - 1] ? ` (${arabicDigits(surahs[surahNo - 1].ayahs)})` : ""}
          </span>
          <span>{arabicDigits(page.p)}</span>
          <span className="page-head-juz">
            <span className="pair" title={`${page.p}`}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path
                  d="M12 6.5C10 5 7 4.5 3.5 5v13c3.5-.5 6.5 0 8.5 1.5 2-1.5 5-2 8.5-1.5V5C17 4.5 14 5 12 6.5zM12 6.5v13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
              <b className={page.p % 2 === 1 ? "cur" : ""}>{arabicDigits(page.p % 2 === 1 ? page.p : page.p - 1)}</b>
              <b className={page.p % 2 === 0 ? "cur" : ""}>{arabicDigits(page.p % 2 === 1 ? page.p + 1 : page.p)}</b>
            </span>
            الجزء {arabicDigits(page.j)}
            {page.r ? ` (${arabicDigits(((page.r - 1) % 8) + 1)}/${arabicDigits(8)})` : ""}
            {bookmark && (
              <button
                type="button"
                className={`bookmark ${bookmark.on ? "on" : ""}`}
                onClick={bookmark.toggle}
                aria-pressed={bookmark.on}
                aria-label={t("bookmark")}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path
                    d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1z"
                    fill={bookmark.on ? "currentColor" : "none"}
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </span>
        </div>
      )}
      {page.l.map((line, li) => {
        const isBridge = !!bridge && !!active && li === active[1];
        const inActive = !active || (li >= active[0] && li < active[1]) || isBridge;
        if (onlyActive && !inActive) return null;
        // Слова-мостик: первые `bridge` слов строки (с концами аятов между ними), остальное приглушено.
        let bridgeEnd = line.w.length;
        if (isBridge) {
          let words = 0;
          bridgeEnd = line.w.findIndex((x) => typeof x !== "number" && ++words > bridge!);
          if (bridgeEnd < 0) bridgeEnd = line.w.length;
        }
        const start = starts.find((s) => s.beforeLine === li);
        const surah = start ? surahs[start.surah - 1] : undefined;
        const covered = inActive && hidden && !peek;
        const wide = line.w.length > 3;
        return (
          <div key={line.n}>
            {start && (
              <div className={`surah-head ${inActive && !isBridge ? "" : "dim"}`}>
                <div className="surah-title">سُورَةُ {surah ? surah.ar.replace(/^سورة\s*/, "") : start.surah}</div>
                {surah?.basmala && start.surah !== 1 && start.surah !== 9 && <div className="basmala">{BASMALA}</div>}
              </div>
            )}
            <div
              className={`line ${wide ? "wide" : "narrow"} ${inActive ? "on" : "dim"} ${covered ? "covered" : ""}`}
              data-line={li + 1}
            >
              {line.w.map((w, wi) => {
                const key = `${page.p}:${li}:${wi}`;
                const text = useGlyphs ? (line.c![wi] ?? "") : typeof w === "number" ? "۝" + arabicDigits(w) : w;
                const off = wi >= bridgeEnd ? " off" : "";
                if (typeof w === "number") {
                  return (
                    <span key={wi} className={`ayah-end${off}`}>
                      {text}
                    </span>
                  );
                }
                const mark = marks?.[key];
                return (
                  <span
                    key={wi}
                    className={`w ${mark === 1 ? "err" : mark === 2 ? "note" : ""} ${onWord ? "tap" : ""}${off}`}
                    onClick={onWord && inActive ? () => onWord(key) : undefined}
                  >
                    {text}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { useLayoutEffect, useRef } from "react";
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
}

/**
 * Подбирает размер шрифта так, чтобы самая длинная строка помещалась по ширине:
 * строки мусхафа нельзя переносить, иначе номера строк перестанут совпадать с бумажным мусхафом.
 */
function useFitLines(key: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const fit = () => {
      el.style.fontSize = "";
      const base = parseFloat(getComputedStyle(el).fontSize);
      let ratio = 1;
      el.querySelectorAll<HTMLElement>(".line").forEach((line) => {
        if (line.clientWidth) ratio = Math.max(ratio, line.scrollWidth / line.clientWidth);
      });
      if (ratio > 1) el.style.fontSize = `${Math.floor((base / ratio) * 0.97 * 10) / 10}px`;
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
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [key]);
  return ref;
}

const BASMALA = "بِسۡمِ ٱللَّهِ ٱلرَّحۡمَٰنِ ٱلرَّحِيمِ";

export function PageView({ mushaf, page, surahs, active, hidden, peek, onlyActive, marks, onWord }: Props) {
  const starts = surahStarts(page);
  const ref = useFitLines([page.p, mushaf, onlyActive, active?.[0], active?.[1]].join("|"));
  return (
    <div ref={ref} className={`page page-${mushaf}`} dir="rtl" lang="ar">
      {page.l.map((line, li) => {
        const inActive = !active || (li >= active[0] && li < active[1]);
        if (onlyActive && !inActive) return null;
        const start = starts.find((s) => s.beforeLine === li);
        const surah = start ? surahs[start.surah - 1] : undefined;
        const covered = inActive && hidden && !peek;
        const wide = line.w.length > 3;
        return (
          <div key={line.n}>
            {start && (
              <div className={`surah-head ${inActive ? "" : "dim"}`}>
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
                if (typeof w === "number") {
                  return (
                    <span key={wi} className="ayah-end">
                      {"۝" + arabicDigits(w)}
                    </span>
                  );
                }
                const mark = marks?.[key];
                return (
                  <span
                    key={wi}
                    className={`w ${mark === 1 ? "err" : mark === 2 ? "note" : ""} ${onWord ? "tap" : ""}`}
                    onClick={onWord && inActive ? () => onWord(key) : undefined}
                  >
                    {w}
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

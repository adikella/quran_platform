import { useEffect, useRef, useState } from "react";
import { PageView } from "../components/PageView";
import { activeStudent, setBookmark, useAppState } from "../store";
import { useMeta, usePages, useSurahs, useT } from "../hooks";
import { pageSurahs, surahName, verseSpanLabel } from "../mushaf";
import { Icon } from "../icons";
import { MushafIndex } from "../components/MushafIndex";
import type { MushafId } from "../types";

/** На широком экране мусхаф открывается разворотом: нечётная страница справа, следующая слева. */
function useWide() {
  const q = "(min-width: 1000px)";
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/** Просмотр мусхафа по страницам. */
export function MushafScreen({ mushaf, page, setPage }: { mushaf: MushafId; page: number; setPage: (p: number) => void }) {
  const t = useT();
  const app = useAppState();
  const { lang } = app;
  const student = activeStudent(app);
  const meta = useMeta(mushaf);
  const surahs = useSurahs();
  const wide = useWide();
  const pages = meta?.pages ?? 604;
  const right = wide && page % 2 === 0 ? page - 1 : page;
  const shown = wide && right + 1 <= pages ? [right, right + 1] : [right];
  const step = wide ? 2 : 1;
  const { data, error } = usePages(mushaf, shown);
  const info = meta?.page[page - 1];

  const [open, setOpen] = useState(false);
  const next = () => right + step <= pages && setPage(right + step);
  const prev = () => right > 1 && setPage(Math.max(1, right - step));
  // Свайп как в бумажном мусхафе: палец вправо открывает следующую страницу, влево предыдущую.
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const [turn, setTurn] = useState<"next" | "prev" | null>(null);
  const swipe = {
    onTouchStart: (e: React.TouchEvent) => {
      const p = e.touches[0];
      touch.current = e.touches.length === 1 ? { x: p.clientX, y: p.clientY, t: Date.now() } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const s0 = touch.current;
      touch.current = null;
      if (!s0) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - s0.x;
      const dy = p.clientY - s0.y;
      if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - s0.t > 800) return;
      if (dx > 0 && right + step <= pages) {
        setTurn("next");
        next();
      } else if (dx < 0 && right > 1) {
        setTurn("prev");
        prev();
      }
    },
  };

  return (
    <div className={`screen ${wide ? "screen-spread" : "screen-mushaf"}`}>
      <div className="mushaf-nav">
        <button
          className="ghost small icon-btn"
          onClick={next}
          disabled={right + step > pages}
          aria-label={t("idx_next")}
        >
          <Icon name="back" size={20} />
        </button>
        <button className="ghost index-open" onClick={() => setOpen(true)} disabled={!meta || !surahs.length}>
          <Icon name="list" size={18} />
          <span>
            <b>{meta && surahs.length ? pageSurahs(meta, page, surahs).map((x) => surahName(surahs[x.surah - 1], lang)).join(", ") : t("idx_title")}</b>
            <small>
              {t("page")} {page}, {t("juz").toLowerCase()} {info?.[0] ?? 1}
            </small>
          </span>
        </button>
        <button className="ghost small icon-btn" onClick={prev} disabled={right <= 1} aria-label={t("idx_prev")}>
          <Icon name="forward" size={20} />
        </button>
      </div>
      {open && meta && (
        <MushafIndex meta={meta} surahs={surahs} lang={lang} page={page} onPick={setPage} onClose={() => setOpen(false)} />
      )}
      {wide && info && <p className="muted center">{verseSpanLabel(info[1], info[2], surahs, lang)}</p>}
      {error && <p className="muted">{t("loadError")}</p>}
      {data && (
        <div className={`spread ${turn ? `turn-${turn}` : ""}`} key={right} {...swipe} onAnimationEnd={() => setTurn(null)}>
          {data.map((pd) => (
            <PageView
              key={pd.p}
              mushaf={mushaf}
              page={pd}
              surahs={surahs}
              fill={!wide}
              bookmark={
                student
                  ? {
                      on: student.bookmark === pd.p,
                      toggle: () => setBookmark(student.id, student.bookmark === pd.p ? null : pd.p),
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

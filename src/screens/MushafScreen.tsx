import { useEffect, useRef, useState } from "react";
import { PageView } from "../components/PageView";
import { activeStudent, setBookmark, useAppState } from "../store";
import { useMeta, usePages, useSurahs, useT } from "../hooks";
import { pageSurahs, surahName, verseSpanLabel } from "../mushaf";
import { Icon } from "../icons";
import { MushafIndex } from "../components/MushafIndex";
import { StudySheet } from "../components/StudySheet";
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
  const [study, setStudy] = useState<number | null>(null);
  // Режим чтения: нажатие на страницу прячет кнопки и нижнее меню, страница занимает весь экран.
  const [reading, setReading] = useState(false);
  useEffect(() => {
    document.body.classList.toggle("reading", reading);
    return () => document.body.classList.remove("reading");
  }, [reading]);
  const next = () => right + step <= pages && setPage(right + step);
  const prev = () => right > 1 && setPage(Math.max(1, right - step));
  // Свайп как в бумажном мусхафе: палец вправо открывает следующую страницу, влево предыдущую.
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const [turn, setTurn] = useState<"next" | "prev" | null>(null);
  const turnTo = (dir: "next" | "prev") => {
    if (dir === "next" ? right + step > pages : right <= 1) return;
    setTurn(dir);
    if (dir === "next") next();
    else prev();
  };
  // Свежая функция для слушателей, которые вешаются один раз.
  const turnRef = useRef(turnTo);
  turnRef.current = turnTo;
  const blocked = open || study !== null;

  // Тачпад (два пальца вбок) и стрелки клавиатуры, как свайп: вправо вперёд, влево назад.
  useEffect(() => {
    if (blocked) return;
    let sum = 0;
    let quietUntil = 0;
    let reset = 0;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      // Иначе браузер уйдёт назад по истории.
      e.preventDefault();
      const now = Date.now();
      if (now < quietUntil) return;
      sum += e.deltaX;
      clearTimeout(reset);
      reset = window.setTimeout(() => (sum = 0), 200);
      if (Math.abs(sum) > 60) {
        // Пальцы вправо дают отрицательный сдвиг: это следующая страница.
        turnRef.current(sum < 0 ? "next" : "prev");
        sum = 0;
        quietUntil = now + 700;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select")) return;
      // В мусхафе следующая страница слева.
      if (e.key === "ArrowLeft") turnRef.current("next");
      if (e.key === "ArrowRight") turnRef.current("prev");
    };
    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("wheel", onWheel);
      window.removeEventListener("keydown", onKey);
      clearTimeout(reset);
    };
  }, [blocked]);
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
      turnTo(dx > 0 ? "next" : "prev");
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
        <div className={`spread ${turn ? `turn-${turn}` : ""}`} key={right} {...swipe} onAnimationEnd={() => setTurn(null)} onClick={(e) => !wide && !(e.target as HTMLElement).closest("button") && setReading((r) => !r)}>
          {data.map((pd) => (
            <PageView
              key={pd.p}
              mushaf={mushaf}
              page={pd}
              surahs={surahs}
              fill={wide ? false : reading ? "reading" : "chrome"}
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
      {data && (
        <div className="study-open">
          {data.map((pd) => (
            <button key={pd.p} className="ghost wide" onClick={() => setStudy(pd.p)}>
              {t("st_open")}
              {data.length > 1 ? `, ${t("page").toLowerCase()} ${pd.p}` : ""}
            </button>
          ))}
        </div>
      )}
      {study !== null && data && (
        <StudySheet
          page={study}
          verses={data.find((pd) => pd.p === study)?.v ?? []}
          surahs={surahs}
          lang={lang}
          onClose={() => setStudy(null)}
        />
      )}
    </div>
  );
}

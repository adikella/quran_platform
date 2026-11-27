import { useEffect, useState } from "react";
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

  return (
    <div className={`screen ${wide ? "screen-spread" : ""}`}>
      <div className="mushaf-nav">
        <button
          className="ghost small icon-btn"
          onClick={() => setPage(Math.min(pages, right + step))}
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
        <button className="ghost small icon-btn" onClick={() => setPage(Math.max(1, right - step))} disabled={right <= 1} aria-label={t("idx_prev")}>
          <Icon name="forward" size={20} />
        </button>
      </div>
      {open && meta && (
        <MushafIndex meta={meta} surahs={surahs} lang={lang} page={page} onPick={setPage} onClose={() => setOpen(false)} />
      )}
      {info && <p className="muted center">{verseSpanLabel(info[1], info[2], surahs, lang)}</p>}
      {error && <p className="muted">{t("loadError")}</p>}
      {data && (
        <div className="spread">
          {data.map((pd) => (
            <PageView
              key={pd.p}
              mushaf={mushaf}
              page={pd}
              surahs={surahs}
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

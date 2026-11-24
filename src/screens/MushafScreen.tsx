import { useEffect, useState } from "react";
import { PageView } from "../components/PageView";
import { activeStudent, setBookmark, useAppState } from "../store";
import { useMeta, usePages, useSurahs, useT } from "../hooks";
import { verseSpanLabel } from "../mushaf";
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

  const juzFirst = new Map<number, number>();
  meta?.page.forEach(([j], i) => !juzFirst.has(j) && juzFirst.set(j, i + 1));

  return (
    <div className={`screen ${wide ? "screen-spread" : ""}`}>
      <div className="mushaf-nav">
        <button className="ghost small" onClick={() => setPage(Math.min(pages, right + step))} disabled={right + step > pages}>
          ←
        </button>
        <label className="inline">
          {t("goToPage")}
          <input
            type="number"
            min={1}
            max={pages}
            value={page}
            onChange={(e) => setPage(Math.max(1, Math.min(pages, Number(e.target.value) || 1)))}
          />
        </label>
        <select value={info?.[0] ?? 1} onChange={(e) => setPage(juzFirst.get(Number(e.target.value)) ?? 1)}>
          {[...juzFirst.keys()].map((j) => (
            <option key={j} value={j}>
              {t("juz")} {j}
            </option>
          ))}
        </select>
        <button className="ghost small" onClick={() => setPage(Math.max(1, right - step))} disabled={right <= 1}>
          →
        </button>
      </div>
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

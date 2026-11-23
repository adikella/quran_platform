import { PageView } from "../components/PageView";
import { useAppState } from "../store";
import { useMeta, usePages, useSurahs, useT } from "../hooks";
import { verseSpanLabel } from "../mushaf";
import type { MushafId } from "../types";

/** Просмотр мусхафа по страницам. */
export function MushafScreen({ mushaf, page, setPage }: { mushaf: MushafId; page: number; setPage: (p: number) => void }) {
  const t = useT();
  const { lang } = useAppState();
  const meta = useMeta(mushaf);
  const surahs = useSurahs();
  const { data, error } = usePages(mushaf, [page]);
  const pages = meta?.pages ?? 604;
  const info = meta?.page[page - 1];

  const juzFirst = new Map<number, number>();
  meta?.page.forEach(([j], i) => !juzFirst.has(j) && juzFirst.set(j, i + 1));

  return (
    <div className="screen">
      <div className="mushaf-nav">
        <button className="ghost small" onClick={() => setPage(Math.min(pages, page + 1))} disabled={page >= pages}>
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
        <button className="ghost small" onClick={() => setPage(Math.max(1, page - 1))} disabled={page <= 1}>
          →
        </button>
      </div>
      {info && <p className="muted center">{verseSpanLabel(info[1], info[2], surahs, lang)}</p>}
      {error && <p className="muted">{t("loadError")}</p>}
      {data?.[0] && <PageView mushaf={mushaf} page={data[0]} surahs={surahs} />}
    </div>
  );
}

import { useMeta, useT } from "../hooks";
import { revision } from "../method";
import type { Student } from "../types";

type Status = "manzil" | "sabki" | "current" | "nazira" | "none";

/** Карта: все страницы выбранного мусхафа по джузам, у каждой свой статус. */
export function ProgressScreen({ student, openPage }: { student: Student; openPage: (p: number) => void }) {
  const t = useT();
  const meta = useMeta(student.mushaf);
  if (!meta) return <p className="muted pad">{t("loading")}</p>;

  const lineCount = (p: number) => meta.page[p - 1][3];
  const juzOf = (p: number) => meta.page[p - 1][0];
  const rev = revision(student, juzOf, lineCount);
  const status = new Map<number, Status>();
  student.nazira.read.forEach((p) => status.set(p, "nazira"));
  rev.manzilGroups.forEach((g) => g.pages.forEach((p) => status.set(p, "manzil")));
  rev.sabki.forEach((r) => status.set(r.page, r.to >= lineCount(r.page) ? "sabki" : "current"));
  const h = student.hifz;
  if (student.stage === "hifz" && !h.memorized.includes(h.cur.page)) status.set(h.cur.page, "current");

  const byJuz = new Map<number, number[]>();
  meta.page.forEach(([j], i) => {
    const list = byJuz.get(j) ?? [];
    list.push(i + 1);
    byJuz.set(j, list);
  });

  const legend: Status[] = ["manzil", "sabki", "current", "nazira", "none"];
  return (
    <div className="screen">
      <section className="card">
        <p>{t("pagesMemorized", { n: h.memorized.length })}</p>
        <div className="legend">
          {legend.map((s) => (
            <span key={s}>
              <i className={`cell ${s}`} /> {t(`legend_${s}` as const)}
            </span>
          ))}
        </div>
      </section>
      <section className="card map">
        {[...byJuz.entries()].map(([j, pages]) => (
          <div key={j} className="juz-row">
            <span className="juz-num">{j}</span>
            <div className="cells">
              {pages.map((p) => (
                <button
                  key={p}
                  className={`cell ${status.get(p) ?? "none"}`}
                  title={`${t("page")} ${p}`}
                  aria-label={`${t("page")} ${p}`}
                  onClick={() => openPage(p)}
                />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

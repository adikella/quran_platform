import { useMeta, useT } from "../hooks";
import { LearnedEditor } from "../components/LearnedPicker";
import { learnedOf } from "../learned";
import { revision } from "../method";
import type { Student } from "../types";

type Status = "manzil" | "sabki" | "current" | "nazira" | "none";

/** Карта: все страницы выбранного мусхафа по джузам, у каждой свой статус. */
export function ProgressScreen({ student, openPage, edit }: { student: Student; openPage?: (p: number) => void; edit?: boolean }) {
  const t = useT();
  const meta = useMeta(student.mushaf);
  if (!meta) return <p className="muted pad">{t("loading")}</p>;

  const rev = revision(student, meta);
  const h = student.hifz;
  const full = new Set(h.memorized);
  const learned = learnedOf(h, meta);
  const status = new Map<number, Status>();
  student.nazira.read.forEach((p) => status.set(p, "nazira"));
  rev.manzilQueue.forEach((u) => u.ranges.forEach((r) => status.set(r.page, "manzil")));
  rev.sabki.forEach((r) => status.set(r.page, "sabki"));
  rev.sabkiWaiting.forEach((p) => status.set(p, "sabki"));
  if (student.stage === "hifz" && !full.has(h.cur.page)) status.set(h.cur.page, "current");
  const half = (p: number) => (!full.has(p) && learned.has(p) && status.get(p) !== "current" ? " half" : "");

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
        {edit && student.stage === "hifz" && <LearnedEditor key={student.id} student={student} meta={meta} />}
      </section>
      <section className="card map">
        {[...byJuz.entries()].map(([j, pages]) => (
          <div key={j} className="juz-row">
            <span className="juz-num">{j}</span>
            <div className="cells">
              {pages.map((p) => (
                <button
                  key={p}
                  className={`cell ${status.get(p) ?? "none"}${half(p)}`}
                  title={`${t("page")} ${p}`}
                  aria-label={`${t("page")} ${p}`}
                  disabled={!openPage}
                  onClick={() => openPage?.(p)}
                />
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

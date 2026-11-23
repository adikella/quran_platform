import { useAppState } from "../store";
import { useMeta, useSurahs, useT } from "../hooks";
import { verseSpanLabel } from "../mushaf";
import type { Student, Submission } from "../types";

function SubLine({ sub }: { sub: Submission }) {
  const { lang } = useAppState();
  const surahs = useSurahs();
  const t = useT();
  return (
    <div className="sub-line">
      <span>{verseSpanLabel(sub.fromVerse, sub.toVerse, surahs, lang)}</span>
      <span className={`pill ${sub.passed ? "ok" : "bad"}`}>
        {sub.grade}
        {!sub.passed && ` · ${t("retake")}`}
      </span>
    </div>
  );
}

/** Дневник: те же колонки, что в бумажном дневнике медресе. */
export function JournalScreen({ student }: { student: Student }) {
  const t = useT();
  const { lang } = useAppState();
  const surahs = useSurahs();
  const meta = useMeta(student.mushaf);
  const dates = new Set<string>([...Object.keys(student.days), ...student.submissions.map((s) => s.date)]);
  const sorted = [...dates].sort().reverse();
  if (!sorted.length) return <p className="muted pad">{t("journalEmpty")}</p>;

  const fmtDate = (d: string) =>
    new Date(d + "T12:00:00").toLocaleDateString(lang === "kk" ? "kk-KZ" : lang, { day: "numeric", month: "short", weekday: "short" });

  return (
    <div className="screen">
      {sorted.map((date) => {
        const subs = student.submissions.filter((s) => s.date === date);
        const day = student.days[date];
        const ustaz = subs.filter((s) => s.kind === "sabak" || s.kind === "nazira");
        const sabki = subs.filter((s) => s.kind === "sabki");
        const manzil = subs.filter((s) => s.kind === "manzil");
        const seconds = Object.values(day?.seconds ?? {}).reduce((a, b) => a + (b ?? 0), 0);
        return (
          <section key={date} className="card journal-day">
            <div className="card-head">
              <h3>{fmtDate(date)}</h3>
              <span className="muted">
                {t("col_reps")}: {day?.reps ?? 0} · {t("col_time")}: {Math.round(seconds / 60)} {t("min")}
              </span>
            </div>
            <dl>
              <dt>{t("col_ustaz")}</dt>
              <dd>{ustaz.length ? ustaz.map((s) => <SubLine key={s.id} sub={s} />) : "—"}</dd>
              <dt>{t("col_sabak")}</dt>
              <dd>
                {day?.learned.length
                  ? day.learned.map((l, i) => <div key={i}>{verseSpanLabel(l.fromVerse, l.toVerse, surahs, lang)}</div>)
                  : "—"}
              </dd>
              <dt>{t("col_sabki")}</dt>
              <dd>{sabki.length ? sabki.map((s) => <SubLine key={s.id} sub={s} />) : "—"}</dd>
              <dt>{t("col_manzil")}</dt>
              <dd>
                {manzil.length
                  ? manzil.map((s) => {
                      const juz = meta ? [...new Set(s.ranges.map((r) => meta.page[r.page - 1][0]))] : [];
                      return (
                        <div key={s.id} className="sub-line">
                          <span>
                            {t("juz")} {juz.join(", ")}
                          </span>
                          <span className={`pill ${s.passed ? "ok" : "bad"}`}>{s.grade}</span>
                        </div>
                      );
                    })
                  : "—"}
              </dd>
            </dl>
          </section>
        );
      })}
    </div>
  );
}

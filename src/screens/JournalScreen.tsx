import { useAppState } from "../store";
import { useMeta, useSurahs, useT } from "../hooks";
import { verseSpanLabel } from "../mushaf";
import type { Student, Submission } from "../types";

/** «раз» или «раза»: 2 раза, 5 раз, 22 раза, 157 раз. */
function razWord(n: number) {
  const a = n % 10;
  const b = n % 100;
  return a >= 2 && a <= 4 && (b < 12 || b > 14) ? "раза" : "раз";
}

function SubLine({ sub, onOpen }: { sub: Submission; onOpen?: (s: Submission) => void }) {
  const { lang } = useAppState();
  const surahs = useSurahs();
  const t = useT();
  const open = onOpen && (sub.marks || sub.comment) ? () => onOpen(sub) : undefined;
  return (
    <div className="sub-line">
      <span>
        {verseSpanLabel(sub.fromVerse, sub.toVerse, surahs, lang)}
        {sub.peeks ? <span className="muted"> ({t("check_peeks")}: {sub.peeks})</span> : null}
        {open && (
          <button className="link inline" onClick={open}>
            {t(sub.by === "partner" ? "result_openPartner" : "result_open")}
          </button>
        )}
      </span>
      <span className={`pill ${sub.passed ? "ok" : "bad"}`}>
        {sub.grade}
        {!sub.passed && `, ${t("retake")}`}
      </span>
    </div>
  );
}

/** Дневник: те же колонки, что в бумажном дневнике медресе. */
export function JournalScreen({ student, onOpen }: { student: Student; onOpen?: (s: Submission) => void }) {
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
                {t("col_reps")}: {day?.reps ?? 0}, {t("col_time")}: {Math.round(seconds / 60)} {t("min")}
              </span>
            </div>
            <dl>
              <dt>{t("col_ustaz")}</dt>
              <dd>{ustaz.length ? ustaz.map((s) => <SubLine key={s.id} sub={s} onOpen={onOpen} />) : t("none")}</dd>
              <dt>{t("col_sabak")}</dt>
              <dd>
                {day?.learned.length
                  ? day.learned.map((l, i) => (
                      <div key={i} className="sub-line">
                        <span>{verseSpanLabel(l.fromVerse, l.toVerse, surahs, lang)}</span>
                        {l.reps !== undefined && <span className="muted">{t("readTimes", { n: l.reps, raz: razWord(l.reps) })}</span>}
                      </div>
                    ))
                  : t("none")}
              </dd>
              <dt>{t("col_sabki")}</dt>
              <dd>{sabki.length ? sabki.map((s) => <SubLine key={s.id} sub={s} onOpen={onOpen} />) : t("none")}</dd>
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
                          {onOpen && (s.marks || s.comment) && (
                            <button className="link inline" onClick={() => onOpen(s)}>
                              {t(s.by === "partner" ? "result_openPartner" : "result_open")}
                            </button>
                          )}
                          <span className={`pill ${s.passed ? "ok" : "bad"}`}>{s.grade}</span>
                        </div>
                      );
                    })
                  : t("none")}
              </dd>
            </dl>
          </section>
        );
      })}
    </div>
  );
}

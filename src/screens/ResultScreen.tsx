import { PageView } from "../components/PageView";
import { usePages, useSurahs, useT } from "../hooks";
import { Icon } from "../icons";
import type { Student, Submission } from "../types";

/** Что отметил учитель: оценка, слова с ошибками, слова учителя. */
export function ResultScreen({ student, sub, onClose }: { student: Student; sub: Submission; onClose: () => void }) {
  const t = useT();
  const surahs = useSurahs();
  // Показываем только страницы с ошибками: давнее бывает на сорок страниц.
  const bad = sub.ranges.filter((r) =>
    Object.keys(sub.marks ?? {}).some((k) => {
      const [p, li] = k.split(":").map(Number);
      return p === r.page && li >= r.from && li < r.to;
    }),
  );
  const { data } = usePages(
    student.mushaf,
    bad.map((r) => r.page),
  );
  return (
    <div className="screen">
      <header className="bar-top">
        <button className="ghost small" onClick={onClose}>
          <Icon name="back" size={16} /> {t("back")}
        </button>
        <span className={`pill ${sub.passed ? "ok" : "bad"}`}>{t(sub.passed ? "passed" : "retake")}</span>
      </header>
      <h2>{t(`check_${sub.kind}` as const)}</h2>
      <div className="check-sums">
        <span>
          {t("errors")}: <b className="err-text">{sub.errors}</b>
        </span>
        <span>
          {t("notes")}: <b className="note-text">{sub.notes}</b>
        </span>
        <span>
          {t("grade")}: <b>{sub.grade}</b>
        </span>
      </div>
      {sub.comment && (
        <section className="card">
          <h3>{t("result_comment")}</h3>
          <p className="said">{sub.comment}</p>
        </section>
      )}
      {!bad.length && <p className="muted">{t("result_clean")}</p>}
      {data?.map((page, i) => (
        <div key={`${page.p}-${i}`} className="check-page">
          <div className="page-label">
            {t("page")} {page.p}
          </div>
          <PageView mushaf={student.mushaf} page={page} surahs={surahs} active={[bad[i].from, bad[i].to]} onlyActive marks={sub.marks} />
        </div>
      ))}
    </div>
  );
}

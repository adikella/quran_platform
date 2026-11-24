import { useEffect, useRef, useState } from "react";
import { PageView, type WordMark } from "../components/PageView";
import { Recorder } from "../components/Recorder";
import { fmtDuration, usePages, useSessionTimer, useSurahs, useT } from "../hooks";
import { gradeFor } from "../method";
import { versesOfRange } from "../mushaf";
import { submit } from "../store";
import { haptic } from "../telegram";
import type { LineRange, Student, Submission, SubmissionKind } from "../types";

interface Props {
  student: Student;
  kind: SubmissionKind;
  ranges: LineRange[];
  groups?: number;
  pages: number;
  lineCount: (p: number) => number;
  onClose: () => void;
}

/**
 * Сдача. Пока ИИ-проверки нет, проверяющий нажимает на слова с ошибками:
 * один раз — явная ошибка, второй — замечание по таджвиду (в оценку не идёт), третий — убрать.
 */
export function CheckScreen({ student, kind, ranges, groups, pages, lineCount, onClose }: Props) {
  const t = useT();
  const surahs = useSurahs();
  const { data } = usePages(
    student.mushaf,
    ranges.map((r) => r.page),
  );
  const [marks, setMarks] = useState<Record<string, WordMark>>({});
  const [result, setResult] = useState<Submission | null>(null);
  const timer = useSessionTimer();
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    top.current?.scrollIntoView();
  }, []);

  const errors = Object.values(marks).filter((m) => m === 1).length;
  const notes = Object.values(marks).filter((m) => m === 2).length;
  const preview = gradeFor(errors, student.method.maxErrors);

  const toggle = (key: string) => {
    haptic("tap");
    setMarks((m) => {
      const cur = m[key];
      const next = { ...m };
      if (!cur) next[key] = 1;
      else if (cur === 1) next[key] = 2;
      else delete next[key];
      return next;
    });
  };

  const finish = () => {
    if (!data) return;
    const spans = ranges.map((r, i) => versesOfRange(data[i], r.from, r.to));
    const all = spans.flat();
    const sorted = [...all].sort((a, b) => {
      const [sa, va] = a.split(":").map(Number);
      const [sb, vb] = b.split(":").map(Number);
      return sa - sb || va - vb;
    });
    const res = submit(
      student.id,
      {
        kind,
        ranges,
        fromVerse: sorted[0],
        toVerse: sorted[sorted.length - 1],
        errors,
        notes,
        seconds: Math.round(timer.read()),
        groups,
      },
      pages,
      lineCount,
    );
    haptic(res.passed ? "success" : "error");
    setResult(res);
  };

  return (
    <div className="screen check" ref={top}>
      <header className="bar-top">
        <button className="ghost small" onClick={onClose}>
          ← {t("back")}
        </button>
        <span className="muted">{fmtDuration(timer.elapsed)}</span>
      </header>
      <h2>{t(`check_${kind}` as const)}</h2>
      <p className="hint">{t("checkHint")}</p>
      <p className="hint muted">{t("aiSoon")}</p>
      <Recorder />

      {!data && <p className="muted">{t("loading")}</p>}
      {data?.map((page, i) => (
        <div key={`${page.p}-${i}`} className="check-page">
          <div className="page-label">
            {t("page")} {page.p}
          </div>
          <PageView
            mushaf={student.mushaf}
            page={page}
            surahs={surahs}
            active={[ranges[i].from, ranges[i].to]}
            onlyActive
            marks={marks}
            onWord={toggle}
          />
        </div>
      ))}

      <div className="check-bar">
        <div>
          {t("errors")}: <b className="err-text">{errors}</b> · {t("notes")}: <b className="note-text">{notes}</b> ·{" "}
          {t("grade")}: <b>{preview.grade}</b>
        </div>
        <button onClick={finish} disabled={!data}>
          {t("finishCheck")}
        </button>
      </div>

      {result && (
        <div className="modal">
          <div className="modal-card">
            <div className={`grade-big ${result.passed ? "ok" : "bad"}`}>{result.grade}</div>
            <h2>{result.passed ? t("passed") : t("retake")}</h2>
            {!result.passed && <p className="muted">{t("retakeNote", { n: student.method.maxErrors })}</p>}
            <p className="muted">
              {t("errors")}: {result.errors} · {t("notes")}: {result.notes}
            </p>
            <button onClick={onClose}>{t("close")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

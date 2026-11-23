import { useEffect, useState } from "react";
import { Counter } from "../components/Counter";
import { PageView } from "../components/PageView";
import { usePages, useSessionTimer, useSurahs, useT } from "../hooks";
import { addRep, addTime, getDay } from "../store";
import { haptic } from "../telegram";
import type { LineRange, Student, TimeCategory } from "../types";

interface Props {
  student: Student;
  title: string;
  ranges: LineRange[];
  category: TimeCategory;
  until?: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel: string;
}

/** Чтение или повторение (назира, сабки, манзиль) со счётчиком и таймером. */
export function ReadScreen({ student, title, ranges, category, until, onClose, onSubmit, submitLabel }: Props) {
  const t = useT();
  const surahs = useSurahs();
  const { data } = usePages(
    student.mushaf,
    ranges.map((r) => r.page),
  );
  const timer = useSessionTimer();
  const [count, setCount] = useState(0);

  useEffect(() => () => addTime(student.id, category, timer.read()), []); // eslint-disable-line react-hooks/exhaustive-deps

  const daily = { reps: getDay(student).reps, target: student.method.dailyTarget };

  return (
    <div className="screen">
      <header className="bar-top">
        <button className="ghost small" onClick={onClose}>
          ← {t("back")}
        </button>
        <span className="muted">{title}</span>
      </header>

      <Counter
        count={count}
        onInc={() => {
          haptic("tap");
          timer.lap();
          setCount((c) => c + 1);
          addRep(student.id);
        }}
        onUndo={() => {
          if (!count) return;
          timer.undoLap();
          setCount((c) => c - 1);
          addRep(student.id, -1);
        }}
        timer={timer}
        daily={daily}
        until={until}
      />

      {!data && <p className="muted">{t("loading")}</p>}
      {data?.map((page, i) => (
        <div key={`${page.p}-${i}`} className="check-page">
          <div className="page-label">
            {t("page")} {page.p}
          </div>
          <PageView mushaf={student.mushaf} page={page} surahs={surahs} active={[ranges[i].from, ranges[i].to]} onlyActive />
        </div>
      ))}

      <button className="sticky-cta" onClick={onSubmit}>
        {submitLabel}
      </button>
    </div>
  );
}

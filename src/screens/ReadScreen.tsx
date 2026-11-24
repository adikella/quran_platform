import { Icon } from "../icons";
import { useEffect, useState } from "react";
import { Counter } from "../components/Counter";
import { PageView } from "../components/PageView";
import { usePages, useSessionTimer, useSurahs, useT } from "../hooks";
import { addTime, patchStudent } from "../store";
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
  /** Сколько раз прочитать; счётчик на этом останавливается. Без него счёт без ограничения. */
  target?: number;
}

/** Чтение или повторение (назира, сабки, манзиль) со счётчиком и таймером. */
export function ReadScreen({ student, title, ranges, category, until, onClose, onSubmit, submitLabel, target }: Props) {
  const t = useT();
  const surahs = useSurahs();
  const { data } = usePages(
    student.mushaf,
    ranges.map((r) => r.page),
  );
  const timer = useSessionTimer();
  const [count, setCount] = useState(0);

  useEffect(() => () => addTime(student.id, category, timer.read()), []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="screen">
      <header className="bar-top">
        <button className="ghost small" onClick={onClose}>
          <Icon name="back" size={16} /> {t("back")}
        </button>
        <span className="muted">{title}</span>
      </header>

      <Counter
        count={count}
        target={target}
        onInc={() => {
          if (target && count >= target) return;
          haptic(target && count + 1 >= target ? "success" : "tap");
          timer.lap();
          setCount((c) => c + 1);
        }}
        onUndo={() => {
          if (!count) return;
          timer.undoLap();
          setCount((c) => c - 1);
        }}
        timer={timer}
        limitMinutes={student.method.sessionMinutes}
        onLimit={(m) => patchStudent(student.id, { method: { ...student.method, sessionMinutes: m } })}
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

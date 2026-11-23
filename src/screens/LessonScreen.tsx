import { useEffect, useMemo, useState } from "react";
import { Counter } from "../components/Counter";
import { PageView } from "../components/PageView";
import { usePages, useSessionTimer, useSurahs, useT } from "../hooks";
import type { Key } from "../i18n";
import { buildSteps } from "../method";
import { versesOfRange } from "../mushaf";
import { abandonLesson, addRep, addTime, finishLesson, getDay, setLessonProgress } from "../store";
import { haptic } from "../telegram";
import type { Step, Student } from "../types";

export function stepLabel(step: Step, lineCount: number, t: (k: Key, v?: Record<string, string | number>) => string) {
  const a = step.range.from + 1;
  const b = step.range.to;
  switch (step.kind) {
    case "readFirst":
      return step.range.from === 0 && step.range.to === lineCount ? t("step_readFirst") : t("step_readFirstPart");
    case "look":
      return t("step_look", { a, b });
    case "blind":
      return t("step_blind", { a, b });
    case "heart":
      return step.hidden ? t("step_heart", { a, b }) : t("step_heartLook", { a, b });
    case "join":
      return t("step_join", { a, b });
    case "whole":
      return t("step_whole");
  }
}

interface Props {
  student: Student;
  onClose: () => void;
  onSubmitNow: () => void;
}

/** Пошаговый помощник заучивания нового урока. */
export function LessonScreen({ student, onClose, onSubmitNow }: Props) {
  const t = useT();
  const surahs = useSurahs();
  const lesson = student.hifz.lesson;
  const { data } = usePages(student.mushaf, lesson ? [lesson.range.page] : []);
  const page = data?.[0];
  const timer = useSessionTimer();
  const [peek, setPeek] = useState(false);
  const [finished, setFinished] = useState(false);

  const steps = useMemo(
    () => (lesson && page ? buildSteps(lesson.range, page.l.length, student.method) : []),
    [lesson?.range.page, lesson?.range.from, lesson?.range.to, page, student.method],
  );

  // Время урока записывается в дневник при выходе с экрана.
  useEffect(() => () => addTime(student.id, "sabak", timer.read()), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!lesson) return null;
  if (!page || !steps.length) {
    return (
      <div className="screen">
        <p className="muted">{t("loading")}</p>
      </div>
    );
  }

  const stepIdx = Math.min(lesson.step, steps.length - 1);
  const step = steps[stepIdx];
  const done = lesson.done;
  const daily = { reps: getDay(student).reps, target: student.method.dailyTarget };

  const inc = () => {
    haptic("tap");
    timer.lap();
    addRep(student.id);
    const d = done + 1;
    if (d >= step.reps) {
      if (stepIdx + 1 < steps.length) {
        haptic("success");
        setLessonProgress(student.id, stepIdx + 1, 0);
      } else {
        setLessonProgress(student.id, stepIdx, d);
        haptic("success");
        setFinished(true);
      }
    } else setLessonProgress(student.id, stepIdx, d);
  };

  const undo = () => {
    if (done > 0) {
      timer.undoLap();
      addRep(student.id, -1);
      setLessonProgress(student.id, stepIdx, done - 1);
    }
  };

  const goStep = (i: number) => setLessonProgress(student.id, Math.max(0, Math.min(steps.length - 1, i)), 0);

  const complete = (now: boolean) => {
    const [fromVerse, toVerse] = versesOfRange(page, lesson.range.from, lesson.range.to);
    finishLesson(student.id, fromVerse, toVerse);
    if (now) onSubmitNow();
    else onClose();
  };

  return (
    <div className="screen lesson">
      <header className="bar-top">
        <button className="ghost small" onClick={onClose}>
          ← {t("back")}
        </button>
        <span className="muted">
          {t("page")} {page.p} · {t("stepOf", { i: stepIdx + 1, n: steps.length })}
        </span>
      </header>

      <div className="steps-track" aria-hidden>
        {steps.map((_, i) => (
          <span key={i} className={i < stepIdx ? "done" : i === stepIdx ? "now" : ""} onClick={() => goStep(i)} />
        ))}
      </div>

      <h2 className="step-title">{stepLabel(step, page.l.length, t)}</h2>

      <PageView
        mushaf={student.mushaf}
        page={page}
        surahs={surahs}
        active={[step.range.from, step.range.to]}
        hidden={step.hidden}
        peek={peek}
      />

      {step.hidden && (
        <button
          className="ghost peek"
          onPointerDown={() => setPeek(true)}
          onPointerUp={() => setPeek(false)}
          onPointerLeave={() => setPeek(false)}
          onContextMenu={(e) => e.preventDefault()}
        >
          {t("peek")}
        </button>
      )}

      <Counter count={done} target={step.reps} onInc={inc} onUndo={undo} timer={timer} daily={daily} />

      <div className="row">
        <button className="ghost" onClick={() => goStep(stepIdx - 1)} disabled={stepIdx === 0}>
          {t("prevStep")}
        </button>
        {stepIdx + 1 < steps.length ? (
          <button className="ghost" onClick={() => goStep(stepIdx + 1)}>
            {t("nextStep")}
          </button>
        ) : (
          <button onClick={() => setFinished(true)}>{t("lessonLearned")}</button>
        )}
      </div>

      <button
        className="link danger"
        onClick={() => {
          abandonLesson(student.id);
          onClose();
        }}
      >
        {t("cancel")}
      </button>

      {finished && (
        <div className="modal">
          <div className="modal-card">
            <h2>{t("lessonLearned")}</h2>
            <p className="muted">{t("pendingNote")}</p>
            <button onClick={() => complete(true)}>{t("submitNow")}</button>
            <button className="ghost" onClick={() => complete(false)}>
              {t("submitLater")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

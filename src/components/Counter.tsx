import { useEffect, useRef } from "react";
import { fmtDuration, useNow, useT } from "../hooks";
import { secondsUntil } from "../method";
import { FloatCounter } from "./FloatCounter";
import { haptic } from "../telegram";
import type { useSessionTimer } from "../hooks";

interface Props {
  count: number;
  target?: number;
  onInc: () => void;
  onUndo: () => void;
  timer: ReturnType<typeof useSessionTimer>;
  /** Дневная норма: сколько уже и сколько нужно. */
  /** Повторения нового урока за день; на экранах повторения не показываются. */
  daily?: { reps: number; target: number };
  /** Обратный отсчёт до конца блока, например "10:00". */
  until?: string;
  /** Минут на занятие (0: время идёт вперёд) и смена этого значения. */
  limitMinutes: number;
  onLimit: (minutes: number) => void;
}

const LIMITS = [5, 10, 15, 30];

/** Счётчик повторений и таймер на одном экране. */
export function Counter({
  count,
  target,
  onInc,
  onUndo,
  timer,
  daily,
  until,
  limitMinutes,
  onLimit,
}: Props) {
  const t = useT();
  const now = useNow(1000);
  const left = until ? secondsUntil(until, now) : null;
  const last = timer.laps[timer.laps.length - 1];
  const avg = timer.laps.length
    ? timer.laps.reduce((a, b) => a + b, 0) / timer.laps.length
    : 0;
  const countdown = limitMinutes > 0;
  const remaining = limitMinutes * 60 - timer.elapsed;
  const over = countdown && remaining <= 0;
  const signalled = useRef(false);
  const plus = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    signalled.current = false;
  }, [limitMinutes]);
  useEffect(() => {
    if (over && !signalled.current) {
      signalled.current = true;
      haptic("success");
    }
  }, [over]);
  const pct = target ? Math.min(100, (count / target) * 100) : 0;

  return (
    <div className="counter">
      <div className="counter-row">
        <button className="ghost small" onClick={onUndo} disabled={count === 0}>
          {t("undo")}
        </button>
        <button
          ref={plus}
          className="plus"
          onClick={onInc}
          style={{ "--pct": `${pct}%` } as React.CSSProperties}
          aria-label={t("plusOne")}
        >
          <span className="plus-count">{count}</span>
          {target ? <span className="plus-target">/ {target}</span> : null}
        </button>
        <button className="ghost small" onClick={timer.toggle}>
          {timer.running ? t("pause") : t("resume")}
        </button>
      </div>

      <div className="stats">
        <div>
          <span className="label">
            {countdown ? t(over ? "overtime" : "timeLeft") : t("timer")}
          </span>
          <b
            className={`${timer.running ? "" : "paused"} ${over ? "over" : ""}`}
          >
            {countdown
              ? (over ? "+" : "") + fmtDuration(Math.abs(remaining))
              : fmtDuration(timer.elapsed)}
          </b>
        </div>
        <div>
          <span className="label">{t("lastRep")}</span>
          <b>{last ? fmtDuration(last) : "—"}</b>
        </div>
        <div>
          <span className="label">{t("avgRep")}</span>
          <b>{avg ? fmtDuration(avg) : "—"}</b>
        </div>
        {left !== null && left > 0 && (
          <div>
            <span className="label">{t("untilEnd", { time: until! })}</span>
            <b>{fmtDuration(left)}</b>
          </div>
        )}
      </div>

      <div className="limits" role="group" aria-label={t("timer")}>
        {LIMITS.map((m) => (
          <button
            key={m}
            className={`chip ${limitMinutes === m ? "on" : ""}`}
            onClick={() => onLimit(m)}
          >
            {m} {t("minShort")}
          </button>
        ))}
        <button
          className={`chip ${limitMinutes === 0 ? "on" : ""}`}
          onClick={() => onLimit(0)}
        >
          {t("timerUp")}
        </button>
      </div>

      <FloatCounter anchor={plus} count={count} target={target} onInc={onInc} />

      {daily && (
        <div className="daily">
          <span>
            {t("dailyReps")}: <b>{daily.reps}</b> / {daily.target}
          </span>
          <div className="bar">
            <div
              style={{
                width: `${Math.min(100, (daily.reps / daily.target) * 100)}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

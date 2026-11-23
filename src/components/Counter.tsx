import { fmtDuration, useNow, useT } from "../hooks";
import { secondsUntil } from "../method";
import type { useSessionTimer } from "../hooks";

interface Props {
  count: number;
  target?: number;
  onInc: () => void;
  onUndo: () => void;
  timer: ReturnType<typeof useSessionTimer>;
  /** Дневная норма: сколько уже и сколько нужно. */
  daily: { reps: number; target: number };
  /** Обратный отсчёт до конца блока, например "10:00". */
  until?: string;
}

/** Счётчик повторений и таймер на одном экране. */
export function Counter({ count, target, onInc, onUndo, timer, daily, until }: Props) {
  const t = useT();
  const now = useNow(1000);
  const left = until ? secondsUntil(until, now) : null;
  const last = timer.laps[timer.laps.length - 1];
  const avg = timer.laps.length ? timer.laps.reduce((a, b) => a + b, 0) / timer.laps.length : 0;
  const pct = target ? Math.min(100, (count / target) * 100) : 0;

  return (
    <div className="counter">
      <div className="counter-row">
        <button className="ghost small" onClick={onUndo} disabled={count === 0}>
          {t("undo")}
        </button>
        <button
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
          <span className="label">{t("timer")}</span>
          <b className={timer.running ? "" : "paused"}>{fmtDuration(timer.elapsed)}</b>
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

      <div className="daily">
        <span>
          {t("dailyReps")}: <b>{daily.reps}</b> / {daily.target}
        </span>
        <div className="bar">
          <div style={{ width: `${Math.min(100, (daily.reps / daily.target) * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}

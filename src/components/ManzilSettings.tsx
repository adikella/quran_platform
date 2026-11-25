import { useT } from "../hooks";
import { manzilBefore, manzilDays, manzilDir, revision } from "../method";
import { patchStudent, setManzilAt, useAppState } from "../store";
import { DateLine } from "./DateLine";
import type { ManzilUnit } from "../method";
import type { Method, MushafMeta, Student } from "../types";

export function useUnitLabel() {
  const t = useT();
  return (u: ManzilUnit) => {
    const pages = u.ranges.map((r) => r.page);
    return t("manzilGroup", { j: u.juz, a: Math.min(...pages), b: Math.max(...pages) });
  };
}

/** Круг давнего: сколько в день, в какую сторону, с чего начать. */
export function ManzilSettings({ student, meta }: { student: Student; meta: MushafMeta }) {
  const t = useT();
  const label = useUnitLabel();
  const m = student.method;
  const { manzilQueue } = revision(student, meta);
  const set = (patch: Partial<Method>) => patchStudent(student.id, { method: { ...m, ...patch } });
  const sizes = [...new Set([0.5, 1, 2, 3, m.manzilJuz])].filter((n) => n > 0).sort((a, b) => a - b);
  const key = (u: ManzilUnit) => `${u.juz}.${u.half ?? 0}`;
  const sorted = [...manzilQueue].sort((a, b) => a.juz - b.juz || (a.half ?? 0) - (b.half ?? 0));
  return (
    <div className="form">
      <label>
        {t("mz_perDay")}
        <select value={m.manzilJuz} onChange={(e) => set({ manzilJuz: Number(e.target.value) })}>
          {sizes.map((n) => (
            <option key={n} value={n}>
              {n === 0.5 ? t("mz_half") : n}
            </option>
          ))}
        </select>
      </label>
      <label>
        {t("mz_order")}
        <select value={manzilDir(student)} onChange={(e) => set({ manzilDir: Number(e.target.value) as 1 | -1 })}>
          <option value={1}>{t("mz_down")}</option>
          <option value={-1}>{t("mz_up")}</option>
        </select>
      </label>
      {sorted.length > 1 && (
        <label>
          {t("mz_start")}
          <select
            value={key(manzilQueue[0])}
            onChange={(e) => {
              const u = manzilQueue.find((x) => key(x) === e.target.value);
              if (u) setManzilAt(student.id, manzilBefore(manzilQueue, u));
            }}
          >
            {sorted.map((u) => (
              <option key={key(u)} value={key(u)}>
                {label(u)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/** Расписание круга на ближайшую неделю. first: через сколько дней первый день (0 сегодня, 1 завтра). */
export function ManzilPlan({ student, meta, first }: { student: Student; meta: MushafMeta; first: 0 | 1 }) {
  const t = useT();
  const { lang } = useAppState();
  const label = useUnitLabel();
  const days = manzilDays(revision(student, meta), student.method);
  return (
    <>
      <p className="muted">{t("mz_circle", { n: days.length })}</p>
      <ol className="mz-days">
        {days.slice(0, 7).map((units, i) => (
          <li key={i}>
            <b>
              <DateLine shift={i + first} lang={lang} />
            </b>
            <span>
              {units.map((u) => (
                <span key={`${u.juz}.${u.half ?? 0}`}>{label(u)}</span>
              ))}
            </span>
          </li>
        ))}
      </ol>
      <p className="muted small-note">{t("mz_waits")}</p>
    </>
  );
}

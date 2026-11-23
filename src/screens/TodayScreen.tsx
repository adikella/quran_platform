import { useState } from "react";
import { useMeta, useT } from "../hooks";
import { naziraTargetPages, nextLessonRange, revision, todayKey } from "../method";
import { beginLesson, getDay, startHifz } from "../store";
import type { LineRange, MushafMeta, Student, SubmissionKind } from "../types";

export type Nav =
  | { name: "lesson" }
  | { name: "check"; kind: SubmissionKind; ranges: LineRange[]; groups?: number }
  | { name: "read"; kind: SubmissionKind; ranges: LineRange[]; groups?: number };

interface Props {
  student: Student;
  go: (n: Nav) => void;
}

export function rangeText(r: LineRange, lineCount: number, t: ReturnType<typeof useT>) {
  if (r.from === 0 && r.to >= lineCount) return `${t("page")} ${r.page}`;
  return `${t("page")} ${r.page}, ${r.from + 1}–${r.to}`;
}

/** «Стр. 63, 1–4 · Стр. 53–62»: подряд идущие целые страницы сворачиваются в диапазон. */
function rangesText(ranges: LineRange[], lineCount: (p: number) => number, t: ReturnType<typeof useT>) {
  const parts: string[] = [];
  let run: number[] = [];
  const flush = () => {
    if (!run.length) return;
    const lo = Math.min(...run);
    const hi = Math.max(...run);
    parts.push(lo === hi ? `${t("page")} ${lo}` : `${t("page")} ${lo}–${hi}`);
    run = [];
  };
  for (const r of ranges) {
    const whole = r.from === 0 && r.to >= lineCount(r.page);
    if (whole && (!run.length || Math.abs(run[run.length - 1] - r.page) === 1)) run.push(r.page);
    else {
      flush();
      if (whole) run.push(r.page);
      else parts.push(rangeText(r, lineCount(r.page), t));
    }
  }
  flush();
  return parts.join(" · ");
}

function lastToday(s: Student, kind: SubmissionKind) {
  const today = todayKey();
  return [...s.submissions].reverse().find((x) => x.kind === kind && x.date === today);
}

function Status({ s, kind }: { s: Student; kind: SubmissionKind }) {
  const t = useT();
  const sub = lastToday(s, kind);
  if (!sub) return null;
  return (
    <span className={`pill ${sub.passed ? "ok" : "bad"}`}>
      {sub.passed ? t("doneToday") : t("retakeToday")} · {sub.grade}
    </span>
  );
}

export function TodayScreen({ student, go }: Props) {
  const t = useT();
  const meta = useMeta(student.mushaf);
  if (!meta) return <p className="muted pad">{t("loading")}</p>;
  return student.stage === "nazira" ? <Nazira s={student} meta={meta} go={go} /> : <Hifz s={student} meta={meta} go={go} />;
}

function DailyBar({ s }: { s: Student }) {
  const t = useT();
  const d = getDay(s);
  const target = s.method.dailyTarget;
  return (
    <div className="card daily">
      <span>
        {t("dailyReps")}: <b>{d.reps}</b> / {target}
      </span>
      <div className="bar">
        <div style={{ width: `${Math.min(100, (d.reps / target) * 100)}%` }} />
      </div>
    </div>
  );
}

function Nazira({ s, meta, go }: { s: Student; meta: MushafMeta; go: Props["go"] }) {
  const t = useT();
  const page = s.nazira.next;
  const lc = meta.page[page - 1][3];
  const range: LineRange = { page, from: 0, to: lc };
  const target = naziraTargetPages(s.method);
  const done = s.nazira.read.length;
  const [startPage, setStartPage] = useState(1);
  const [dir, setDir] = useState<1 | -1>(1);

  return (
    <div className="screen">
      <DailyBar s={s} />
      <section className="card">
        <div className="card-head">
          <h3>{t("naziraToday")}</h3>
          <Status s={s} kind="nazira" />
        </div>
        <p className="big">
          {t("page")} {page}
        </p>
        <div className="row">
          <button className="ghost" onClick={() => go({ name: "read", kind: "nazira", ranges: [range] })}>
            {t("naziraRead")}
          </button>
          <button onClick={() => go({ name: "check", kind: "nazira", ranges: [range] })}>{t("naziraSubmit")}</button>
        </div>
      </section>

      <section className="card">
        <p>{t("naziraProgress", { n: done, total: target })}</p>
        <div className="bar">
          <div style={{ width: `${Math.min(100, (done / target) * 100)}%` }} />
        </div>
      </section>

      {done >= target && (
        <section className="card accent">
          <p>{t("naziraDone")}</p>
          <StartPicker meta={meta} page={startPage} setPage={setStartPage} dir={dir} setDir={setDir} />
          <button onClick={() => startHifz(s.id, startPage, dir)}>{t("startHifz")}</button>
        </section>
      )}
    </div>
  );
}

export function StartPicker({
  meta,
  page,
  setPage,
  dir,
  setDir,
}: {
  meta: MushafMeta;
  page: number;
  setPage: (p: number) => void;
  dir: 1 | -1;
  setDir: (d: 1 | -1) => void;
}) {
  const t = useT();
  return (
    <div className="form">
      <label>
        {t("startPage")}
        <input
          type="number"
          min={1}
          max={meta.pages}
          value={page}
          onChange={(e) => setPage(Math.max(1, Math.min(meta.pages, Number(e.target.value) || 1)))}
        />
      </label>
      <label>
        {t("direction")}
        <select
          value={dir}
          onChange={(e) => {
            const d = Number(e.target.value) as 1 | -1;
            setDir(d);
            setPage(d === -1 ? meta.pages : 1);
          }}
        >
          <option value={1}>{t("dir_forward")}</option>
          <option value={-1}>{t("dir_backward")}</option>
        </select>
      </label>
    </div>
  );
}

function Hifz({ s, meta, go }: { s: Student; meta: MushafMeta; go: Props["go"] }) {
  const t = useT();
  const m = s.method;
  const lineCount = (p: number) => meta.page[p - 1][3];
  const juzOf = (p: number) => meta.page[p - 1][0];
  const rev = revision(s, juzOf, lineCount);
  const { cur, pending, lesson, memorized } = s.hifz;
  const finished = memorized.includes(cur.page) && cur.line >= lineCount(cur.page);
  const manzilRanges: LineRange[] = rev.manzilToday.flatMap((g) => g.pages.map((p) => ({ page: p, from: 0, to: lineCount(p) })));
  const sabkiCount = rev.sabki.length;

  return (
    <div className="screen">
      <DailyBar s={s} />

      <div className="block-label">{t("afterFajr")}</div>
      <section className="card">
        <div className="card-head">
          <h3>{t("sabakSubmit")}</h3>
          <Status s={s} kind="sabak" />
        </div>
        {pending ? (
          <>
            <p>{rangeText(pending, lineCount(pending.page), t)}</p>
            <button onClick={() => go({ name: "check", kind: "sabak", ranges: [pending] })}>{t("sabakSubmit")}</button>
          </>
        ) : (
          <p className="muted">{t("nothingYet")}</p>
        )}
      </section>

      <div className="block-label">{t("morningBlock", { a: m.morningStart, b: m.morningEnd })}</div>
      <section className="card">
        <div className="card-head">
          <h3>{t("col_sabki")}</h3>
          <Status s={s} kind="sabki" />
        </div>
        {sabkiCount ? (
          <>
            <p>
              {t("sabkiPages", { n: sabkiCount })}:{" "}
              <span className="muted">{rangesText(rev.sabki, lineCount, t)}</span>
            </p>
            <div className="row">
              <button className="ghost" onClick={() => go({ name: "read", kind: "sabki", ranges: rev.sabki })}>
                {t("readCounter")}
              </button>
              <button onClick={() => go({ name: "check", kind: "sabki", ranges: rev.sabki })}>{t("sabkiSubmit")}</button>
            </div>
          </>
        ) : (
          <p className="muted">{t("nothingYet")}</p>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <h3>{t("col_manzil")}</h3>
          <Status s={s} kind="manzil" />
        </div>
        {rev.manzilToday.length ? (
          <>
            <p>{rev.manzilToday.map((g) => t("manzilJuz", { j: g.juz, n: g.pages.length })).join(" · ")}</p>
            <div className="row">
              <button
                className="ghost"
                onClick={() => go({ name: "read", kind: "manzil", ranges: manzilRanges, groups: rev.manzilToday.length })}
              >
                {t("readCounter")}
              </button>
              <button
                onClick={() => go({ name: "check", kind: "manzil", ranges: manzilRanges, groups: rev.manzilToday.length })}
              >
                {t("manzilSubmit")}
              </button>
            </div>
          </>
        ) : (
          <p className="muted">{t("nothingYet")}</p>
        )}
      </section>

      <div className="block-label">{t("afterMorning", { b: m.morningEnd })}</div>
      <section className="card accent">
        <h3>{t("newLesson")}</h3>
        {finished ? (
          <p>{t("hifzFinished")}</p>
        ) : lesson ? (
          <>
            <p>{rangeText(lesson.range, lineCount(lesson.range.page), t)}</p>
            <button onClick={() => go({ name: "lesson" })}>{t("continueLesson")}</button>
          </>
        ) : pending ? (
          <p className="muted">{t("blockedByPending")}</p>
        ) : (
          <>
            <p>{rangeText(nextLessonRange(cur.page, cur.line, lineCount(cur.page), s.volume), lineCount(cur.page), t)}</p>
            <button
              onClick={() => {
                beginLesson(s.id, lineCount(cur.page));
                go({ name: "lesson" });
              }}
            >
              {t("newLesson")}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

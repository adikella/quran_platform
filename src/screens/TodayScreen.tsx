import { useState } from "react";
import { InstallCard } from "../components/InstallCard";
import { InviteCard, TeacherCard } from "../components/TeacherCard";
import { useMeta, useNow, usePages, useSurahs, useT } from "../hooks";
import { NEW_START, startPage, StartPicker, type Start } from "../components/LearnedPicker";
import { ManzilPlan, ManzilSettings, useUnitLabel } from "../components/ManzilSettings";
import { nextLesson } from "../learned";
import { dayPart, naziraTargetPages, revision, todayKey } from "../method";
import { verseSpanLabel, versesOfRange } from "../mushaf";
import { rangesText, rangeText } from "../ranges";
import { beginLesson, lessonReps, startHifz, useAppState } from "../store";
import { useJob } from "../components/AccountCard";
import { useSync, withdrawSubmission, type Mate, type RemoteSub } from "../sync";
import type { Key } from "../i18n";
import type { LineRange, MushafMeta, Student, Submission, SubmissionKind } from "../types";

export type Nav =
  | { name: "lesson" }
  | { name: "check"; kind: SubmissionKind; ranges: LineRange[]; groups?: number }
  | { name: "result"; sub: Submission }
  | { name: "mate"; mate: Mate; kind: "sabki" | "manzil"; ranges: LineRange[]; groups?: number; sub?: RemoteSub }
  | { name: "read"; kind: SubmissionKind; ranges: LineRange[]; groups?: number };

interface Props {
  student: Student;
  go: (n: Nav) => void;
}

function lastToday(s: Student, kind: SubmissionKind) {
  const today = todayKey();
  return [...s.submissions].reverse().find((x) => x.kind === kind && x.date === today);
}

function Status({ s, kind }: { s: Student; kind: SubmissionKind }) {
  const t = useT();
  const sub = lastToday(s, kind);
  const { waiting } = useSync();
  const sent = waiting.find((w) => w.student === s.id && w.kind === kind);
  if (sent) return <span className="pill wait">{t(sent.partner ? "wait_pillPartner" : "wait_pill")}</span>;
  if (!sub) return null;
  return (
    <span className={`pill ${sub.passed ? "ok" : "bad"}`}>
      {sub.passed ? t("doneToday") : t("retakeToday")}: {sub.grade}
    </span>
  );
}

/** Сдача у учителя: ждёт проверки (можно забрать назад) или последнее его решение с отметками. */
function FromTeacher({ s, kind, go }: { s: Student; kind: SubmissionKind; go: Props["go"] }) {
  const t = useT();
  const { waiting, links } = useSync();
  const { busy, failed, job } = useJob();
  const mine = waiting.find((w) => w.student === s.id && w.kind === kind);
  const link = links.find((l) => l.student === s.id);
  if (mine) {
    return (
      <div className="from-teacher">
        <p className="muted">{t(mine.partner ? "wait_notePartner" : "wait_note", { name: (mine.partner ? link?.partner : link?.teacher) ?? "" })}</p>
        {failed && <p role="alert">{t("net_fail")}</p>}
        <button className="link" disabled={busy} onClick={() => job(() => withdrawSubmission(mine.id))}>
          {t("wait_withdraw")}
        </button>
      </div>
    );
  }
  const last = [...s.submissions].reverse().find((x) => x.kind === kind);
  if (!last?.by || !(last.marks || last.comment)) return null;
  // Вчерашнее принятое показывать незачем, а несданное висит до пересдачи.
  if (last.passed && last.date !== todayKey()) return null;
  return (
    <div className="from-teacher">
      <button className="link" onClick={() => go({ name: "result", sub: last })}>
        {t(last.by === "partner" ? "result_openPartner" : "result_open")}
      </button>
    </div>
  );
}

export function TodayScreen({ student, go }: Props) {
  const t = useT();
  const meta = useMeta(student.mushaf);
  const { joinCode, links } = useSync();
  const link = links.find((l) => l.student === student.id);
  if (!meta) return <p className="muted pad">{t("loading")}</p>;
  return (
    <>
      {(joinCode || link?.status === "pending") && (
        <div className="screen">
          {joinCode ? <InviteCard key={joinCode} student={student} code={joinCode} /> : <TeacherCard student={student} />}
        </div>
      )}
      <Mates student={student} go={go} />
      {student.stage === "nazira" ? <Nazira s={student} meta={meta} go={go} /> : <Hifz s={student} meta={meta} go={go} />}
      <div className="screen">
        <InstallCard dismissible />
      </div>
    </>
  );
}

/** Я напарник: что прислали и что принять рядом. */
function Mates({ student, go }: { student: Student; go: Props["go"] }) {
  const t = useT();
  const { mates } = useSync();
  const { lang } = useAppState();
  const surahs = useSurahs();
  const mine = mates.filter((m) => m.mine === student.id);
  if (!mine.length) return null;
  const today = todayKey();
  return (
    <div className="screen">
      {mine.map((m) => {
        const near = (["sabki", "manzil"] as const).filter((k) => m[k] && m.done[k] !== today && !m.inbox.some((x) => x.kind === k));
        return (
          <section key={m.student} className="card accent">
            <h3>{t("mate_of", { name: m.name })}</h3>
            {m.inbox.map((x) => (
              <button
                key={x.id}
                className="wide"
                onClick={() => go({ name: "mate", mate: m, kind: x.kind as "sabki" | "manzil", ranges: x.ranges, groups: x.groups, sub: x })}
              >
                {t("mate_listen", { k: t(`kind_${x.kind}` as Key), r: verseSpanLabel(x.fromVerse, x.toVerse, surahs, lang) })}
              </button>
            ))}
            {near.map((k) => (
              <button key={k} className="ghost wide mate-near" onClick={() => go({ name: "mate", mate: m, kind: k, ranges: m[k]!.ranges, groups: m[k]!.groups })}>
                {t("mate_near", { r: m[k]!.text })}
              </button>
            ))}
            {!m.inbox.length && !near.length && <p className="muted">{t("mate_nothing")}</p>}
          </section>
        );
      })}
    </div>
  );
}

function DailyBar({ s }: { s: Student }) {
  const t = useT();
  const reps = lessonReps(s);
  const target = s.method.dailyTarget;
  return (
    <div className="card daily">
      <span>
        {t("dailyReps")}: <b>{reps}</b> / {target}
      </span>
      <div className="bar">
        <div style={{ width: `${Math.min(100, (reps / target) * 100)}%` }} />
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
  const [start, setStart] = useState<Start>(NEW_START);
  const begin = () => startHifz(s.id, startPage(start, meta), start.dir, meta, start.known ? start.learned : undefined);

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
        <FromTeacher s={s} kind="nazira" go={go} />
      </section>

      <section className="card">
        <p>{t("naziraProgress", { n: done, total: target })}</p>
        <div className="bar">
          <div style={{ width: `${Math.min(100, (done / target) * 100)}%` }} />
        </div>
      </section>

      {done >= target ? (
        <section className="card accent">
          <p>{t("naziraDone")}</p>
          <StartPicker meta={meta} value={start} onChange={setStart} />
          <button onClick={begin}>{t("startHifz")}</button>
        </section>
      ) : (
        <section className="card">
          {/* Попал на чтение случайно или чтение уже пройдено: сразу к заучиванию. */}
          <h3>{t("toHifzTitle")}</h3>
          <p className="muted">{t("toHifzNote")}</p>
          <StartPicker meta={meta} value={start} onChange={setStart} />
          <button className="ghost" onClick={begin}>
            {t("startHifz")}
          </button>
        </section>
      )}
    </div>
  );
}

function Hifz({ s, meta, go }: { s: Student; meta: MushafMeta; go: Props["go"] }) {
  const t = useT();
  const m = s.method;
  const lineCount = (p: number) => meta.page[p - 1][3];
  const juzOf = (p: number) => meta.page[p - 1][0];
  const rev = revision(s, meta);
  const { pending, lesson } = s.hifz;
  const next = nextLesson(s, meta);
  const manzilRanges: LineRange[] = rev.manzilToday.flatMap((g) => g.ranges);
  // Сдал сегодняшнее: на очереди уже завтрашнее.
  const manzilDone = s.submissions.some((x) => x.kind === "manzil" && x.passed && x.date === todayKey());
  const manzilTomorrow = rev.manzilQueue.slice(rev.manzilToday.length, rev.manzilToday.length * 2);
  const sabkiCount = rev.sabki.length;
  const now = useNow(30000);
  const part = dayPart(now, m);
  const nowKey = (part === "submit" && !pending ? "now_submitNone" : `now_${part}`) as Key;
  const surahs = useSurahs();
  const { lang } = useAppState();
  const manzilLine = useUnitLabel();
  // Сабки записывается так: джуз, сура и аяты (с какого по какой), включая неполную страницу.
  const { data: sabkiPages } = usePages(s.mushaf, rev.sabki.map((r) => r.page));
  const sabkiVerses = sabkiPages
    ? rev.sabki.flatMap((r, i) => versesOfRange(sabkiPages[i], r.from, r.to)).sort((x, y) => {
        const [sa, va] = x.split(":").map(Number);
        const [sb, vb] = y.split(":").map(Number);
        return sa - sb || va - vb;
      })
    : [];
  const sabkiSpan = sabkiVerses.length ? verseSpanLabel(sabkiVerses[0], sabkiVerses[sabkiVerses.length - 1], surahs, lang) : "";
  const sabkiJuz = rev.sabki.length ? juzOf(rev.sabki[0].page) : 0;

  return (
    <div className="screen">
      <DailyBar s={s} />

      <div className="now" role="status">
        <span className="now-lead">{t("nowLead")}</span>
        <b>{t(nowKey)}</b>
      </div>

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
        <FromTeacher s={s} kind="sabak" go={go} />
      </section>

      <div className="block-label">{t("morningBlock", { a: m.morningStart, b: m.morningEnd })}</div>
      <section className="card">
        <div className="card-head">
          <h3>{t("col_sabki")}</h3>
          <Status s={s} kind="sabki" />
        </div>
        {sabkiCount ? (
          <>
            <div className="manzil-today">
              <span className="muted">{t("sabkiTodayLead")}:</span>
              <p>
                <b>
                  {t("juz")} {sabkiJuz}, {sabkiSpan || rangesText(rev.sabki, lineCount, t)}
                </b>
              </p>
              {rev.sabkiWaiting.length > 0 && (
                <p className="muted">
                  {t("sabkiWaiting", {
                    n: Math.max(0, m.sabkiPages - rev.sabkiWaiting.length),
                    a: Math.min(...rev.sabkiWaiting),
                    b: Math.max(...rev.sabkiWaiting),
                  })}
                </p>
              )}
            </div>
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
        <FromTeacher s={s} kind="sabki" go={go} />
      </section>

      <section className="card">
        <div className="card-head">
          <h3>{t("col_manzil")}</h3>
          <Status s={s} kind="manzil" />
        </div>
        {rev.manzilToday.length ? (
          <>
            <div className="manzil-today">
              <span className="muted">{t(manzilDone ? "mz_doneLead" : "manzilTodayLead")}:</span>
              {rev.manzilToday.map((g) => (
                <p key={`${g.juz}.${g.half ?? 0}`}>
                  <b>{manzilLine(g)}</b>
                </p>
              ))}
              {!manzilDone && manzilTomorrow.length > 0 && (
                <p className="muted">
                  {t("manzilNext")}: {manzilTomorrow.map(manzilLine).join("; ")}
                </p>
              )}
            </div>
            <div className="row">
              <button
                className="ghost"
                onClick={() => go({ name: "read", kind: "manzil", ranges: manzilRanges, groups: rev.manzilToday.length })}
              >
                {t("readCounter")}
              </button>
              <button
                className={manzilDone ? "ghost" : ""}
                onClick={() => go({ name: "check", kind: "manzil", ranges: manzilRanges, groups: rev.manzilToday.length })}
              >
                {t("manzilSubmit")}
              </button>
            </div>
            <details className="more">
              <summary>{t("mz_more")}</summary>
              <ManzilPlan student={s} meta={meta} first={manzilDone ? 1 : 0} />
              <ManzilSettings student={s} meta={meta} />
            </details>
          </>
        ) : (
          <p className="muted">{t("nothingYet")}</p>
        )}
        <FromTeacher s={s} kind="manzil" go={go} />
      </section>

      <div className="block-label">{t("afterMorning", { b: m.morningEnd })}</div>
      <section className="card accent">
        <h3>{t("newLesson")}</h3>
        {lesson ? (
          <>
            <p>{rangeText(lesson.range, lineCount(lesson.range.page), t)}</p>
            <button onClick={() => go({ name: "lesson" })}>{t("continueLesson")}</button>
          </>
        ) : pending ? (
          <p className="muted">{t("blockedByPending")}</p>
        ) : !next ? (
          <p>{t("hifzFinished")}</p>
        ) : (
          <>
            <p>{rangeText(next, lineCount(next.page), t)}</p>
            <button
              onClick={() => {
                beginLesson(s.id, meta);
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

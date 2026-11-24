import { useEffect, useRef, useState } from "react";
import { PageView, type WordMark } from "../components/PageView";
import { Recorder } from "../components/Recorder";
import { fmtDuration, usePages, useSessionTimer, useSurahs, useT } from "../hooks";
import { gradeFor } from "../method";
import { versesOfRange } from "../mushaf";
import { compareRecitation } from "../recite";
import { PEEK_SECONDS, SilenceWatch } from "../silence";
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
 * Сдача. Наизусть сдают с закрытым текстом: он открывается, когда чтение закончено.
 * Потом ошибки отмечает ИИ, а проверяющий правит: нажатие на слово ставит ошибку,
 * второе: ошибку таджвида (обе снижают оценку), третье убирает.
 * В кабинете учителя (его ещё нет) текст будет открыт, у ученика закрыт.
 */
export function CheckScreen({ student, kind, ranges, groups, pages, lineCount, onClose }: Props) {
  const t = useT();
  const surahs = useSurahs();
  const { data } = usePages(
    student.mushaf,
    ranges.map((r) => r.page),
  );
  const [marks, setMarks] = useState<Record<string, WordMark>>({});
  const [audio, setAudio] = useState<Blob | null>(null);
  const [ai, setAi] = useState<
    { state: "busy" } | { state: "fail" } | { state: "long" } | { state: "empty" } | { state: "done"; text: string; missed: number; wrong: number; vowel: number } | null
  >(null);
  // Назиру читают по мусхафу, остальное сдают наизусть.
  const byHeart = kind !== "nazira";
  const [open, setOpen] = useState(!byHeart);
  const [recording, setRecording] = useState(false);
  const [offer, setOffer] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const [peeks, setPeeks] = useState(0);
  const [watch, setWatch] = useState(() => new SilenceWatch());
  const [result, setResult] = useState<Submission | null>(null);
  const timer = useSessionTimer();
  const top = useRef<HTMLDivElement>(null);
  // Номер попытки: ответ ИИ по прежней записи не должен попасть в новую.
  const attempt = useRef(0);

  useEffect(() => {
    top.current?.scrollIntoView();
  }, []);

  useEffect(() => {
    if (!peeking) return;
    const id = setTimeout(() => setPeeking(false), PEEK_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [peeking]);

  const peek = () => {
    haptic("tap");
    watch.used();
    setOffer(false);
    setPeeks((n) => n + 1);
    setPeeking(true);
  };

  const onRecording = (on: boolean) => {
    setRecording(on);
    setOffer(false);
    setPeeking(false);
    setOpen(!byHeart || !on);
    if (on) {
      attempt.current++;
      // Новая попытка: прежние отметки и подсказки относятся к прошлой записи.
      setMarks({});
      setPeeks(0);
    } else setWatch(new SilenceWatch());
  };

  const errors = Object.values(marks).filter((m) => m === 1).length;
  const notes = Object.values(marks).filter((m) => m === 2).length;
  // Ошибка таджвида (не протянул мадд и так далее) тоже ошибка и снижает оценку.
  const preview = gradeFor(errors + notes, student.method.maxErrors);

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

  /** Отправить запись на распознавание и отметить слова, где ИИ услышал не то. */
  const checkAi = async () => {
    if (!audio || !data) return;
    setAi({ state: "busy" });
    const mine = attempt.current;
    try {
      const form = new FormData();
      form.append("audio", audio, "recitation");
      const res = await fetch("./api/asr", { method: "POST", body: form });
      if (mine !== attempt.current) return;
      if (res.status === 413) {
        setAi({ state: "long" });
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const { text } = (await res.json()) as { text: string };
      if (mine !== attempt.current) return;
      if (!text) {
        // Тишина: иначе вся страница оказалась бы пропущенной.
        setAi({ state: "empty" });
        return;
      }
      // Слова мусхафа по порядку, с ключами как в PageView и признаком конца аята.
      const keys: string[] = [];
      const words: string[] = [];
      const pausal: boolean[] = [];
      data.forEach((page, i) => {
        const r = ranges[i];
        for (let li = r.from; li < r.to; li++) {
          page.l[li].w.forEach((w, wi) => {
            if (typeof w === "number") {
              if (pausal.length) pausal[pausal.length - 1] = true;
              return;
            }
            keys.push(`${page.p}:${li}:${wi}`);
            words.push(w);
            pausal.push(false);
          });
        }
      });
      const cmp = compareRecitation(words, text, pausal);
      const count = { missed: 0, wrong: 0, vowel: 0 };
      const next: Record<string, WordMark> = { ...marks };
      cmp.words.forEach((v, k) => {
        if (v.status === "ok") return;
        count[v.status]++;
        if (!next[keys[k]]) next[keys[k]] = 1;
      });
      setMarks(next);
      setAi({ state: "done", text, ...count });
      haptic("success");
    } catch {
      if (mine !== attempt.current) return;
      setAi({ state: "fail" });
      haptic("error");
    }
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
        peeks,
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
      <p className="hint">{t(open ? "checkHint" : "check_closed")}</p>
      {open && <p className="hint muted">{t("aiSoon")}</p>}
      <Recorder
        watch={byHeart ? watch : undefined}
        onSilence={setOffer}
        onRecording={onRecording}
        onAudio={(b) => {
          setAudio(b);
          setAi(null);
        }}
      />
      {!open && !recording && (
        <button className="ghost" onClick={() => setOpen(true)}>
          {t("check_open")}
        </button>
      )}
      {audio && (
        <section className="ai-check">
          <button onClick={checkAi} disabled={ai?.state === "busy" || !data}>
            {ai?.state === "busy" ? t("ai_busy") : t("ai_check")}
          </button>
          {ai?.state === "empty" && <p>{t("ai_empty")}</p>}
          {ai?.state === "long" && <p>{t("ai_long")}</p>}
          {ai?.state === "fail" && <p className="muted">{t("ai_fail")}</p>}
          {ai?.state === "done" && (
            <>
              <p>{ai.missed + ai.wrong + ai.vowel ? t("ai_done", ai) : t("ai_clean")}</p>
              <details>
                <summary className="muted">{t("ai_heard")}</summary>
                <p className="ai-heard" dir="rtl" lang="ar">
                  {ai.text}
                </p>
              </details>
            </>
          )}
        </section>
      )}

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
            hidden={!open}
            peek={peeking}
            marks={marks}
            onWord={open ? toggle : undefined}
          />
        </div>
      ))}

      <div className="check-bar">
        {open ? (
          <>
            <div className="check-sums">
              <span>
                {t("errors")}: <b className="err-text">{errors}</b>
              </span>
              <span>
                {t("notes")}: <b className="note-text">{notes}</b>
              </span>
              {byHeart && (
                <span>
                  {t("check_peeks")}: <b>{peeks}</b>
                </span>
              )}
              <span>
                {t("grade")}: <b>{preview.grade}</b>
              </span>
            </div>
            <button onClick={finish} disabled={!data || recording}>
              {t("finishCheck")}
            </button>
          </>
        ) : (
          <>
            <span className="muted">
              {peeking ? t("check_peeking") : offer ? t("check_offer") : recording ? t("check_listening") : t("check_start")}
            </span>
            {offer && (
              <button onClick={peek}>
                {t("peek")}
              </button>
            )}
          </>
        )}
      </div>

      {result && (
        <div className="modal">
          <div className="modal-card">
            <div className={`grade-big ${result.passed ? "ok" : "bad"}`}>{result.grade}</div>
            <h2>{result.passed ? t("passed") : t("retake")}</h2>
            {!result.passed && <p className="muted">{t("retakeNote", { n: student.method.maxErrors })}</p>}
            <p className="muted">
              {t("errors")}: {result.errors}, {t("notes")}: {result.notes}
              {result.peeks ? `, ${t("check_peeks")}: ${result.peeks}` : ""}
            </p>
            <button onClick={onClose}>{t("close")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

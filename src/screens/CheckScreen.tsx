import { useEffect, useRef, useState } from "react";
import { PageView, type WordMark } from "../components/PageView";
import { Recorder } from "../components/Recorder";
import { fmtDuration, usePages, useSessionTimer, useSurahs, useT } from "../hooks";
import { compareVerse, versesOfRange } from "../mushaf";
import { compareRecitation } from "../recite";
import { PEEK_SECONDS, SilenceWatch } from "../silence";
import { Icon } from "../icons";
import { gradeFor, todayKey } from "../method";
import { submit } from "../store";
import { ApiError, loadAudio, sendSubmission, type Link, type RemoteSub, type SubMeta, type VerdictIn } from "../sync";
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
  /** Ученик записан к учителю: запись можно отправить ему. */
  link?: Link;
  /** Проверяет учитель: текст открыт. sub: присланная запись; без неё ученик читает рядом. */
  review?: { sub?: RemoteSub; onVerdict: (meta: SubMeta, v: VerdictIn) => Promise<void> };
}

/**
 * Сдача. Наизусть сдают с закрытым текстом. Без учителя он открывается, когда чтение закончено,
 * и ошибки отмечает ИИ, а проверяющий правит. С учителем у ученика текст остаётся закрытым,
 * запись уходит учителю, а у него в кабинете текст открыт.
 * Нажатие на слово ставит ошибку, второе: ошибку таджвида (обе снижают оценку), третье убирает.
 */
export function CheckScreen({ student, kind, ranges, groups, pages, lineCount, onClose, link, review }: Props) {
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
  // Новый урок и чтение у записанного к учителю принимает только учитель; недавнее и давнее можно и самому.
  const teacherOnly = !review && !!link && (kind === "sabak" || kind === "nazira");
  const canSend = !review && !!link?.consent;
  const [open, setOpen] = useState(!byHeart || !!review);
  const [recording, setRecording] = useState(false);
  const [offer, setOffer] = useState(false);
  const [peeking, setPeeking] = useState(false);
  const [peeks, setPeeks] = useState(0);
  const [watch, setWatch] = useState(() => new SilenceWatch());
  const [result, setResult] = useState<Submission | null>(null);
  const [comment, setComment] = useState("");
  const [post, setPost] = useState<"idle" | "busy" | "fail" | "big" | "gone" | "sent">("idle");
  const [url, setUrl] = useState<string | null>(null);
  const [noAudio, setNoAudio] = useState(false);
  const remoteAudio = review?.sub?.audio ? review.sub.id : null;
  const timer = useSessionTimer();
  const top = useRef<HTMLDivElement>(null);
  // Номер попытки: ответ ИИ по прежней записи не должен попасть в новую.
  const attempt = useRef(0);

  useEffect(() => {
    top.current?.scrollIntoView();
  }, []);

  useEffect(() => {
    if (!remoteAudio) return;
    let live = true;
    let made: string | null = null;
    loadAudio(remoteAudio).then(
      (b) => {
        if (!live) return;
        made = URL.createObjectURL(b);
        setAudio(b);
        setUrl(made);
      },
      () => live && setNoAudio(true),
    );
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [remoteAudio]);

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
    // Запись, которую увидит учитель, не открывает текст ученику.
    setOpen(!byHeart || (!on && !canSend));
    if (on) {
      attempt.current++;
      setPost("idle");
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

  const makeMeta = (): SubMeta | null => {
    if (!data) return null;
    const sorted = ranges.flatMap((r, i) => versesOfRange(data[i], r.from, r.to)).sort(compareVerse);
    return {
      kind,
      ranges,
      fromVerse: sorted[0],
      toVerse: sorted[sorted.length - 1],
      date: todayKey(),
      seconds: Math.round(timer.read()),
      peeks,
      groups,
    };
  };

  const finish = () => {
    const m = makeMeta();
    if (!m) return;
    const { date: _date, ...rest } = m;
    const res = submit(student.id, { ...rest, errors, notes, peeks, seconds: rest.seconds ?? 0 }, pages, lineCount);
    haptic(res.passed ? "success" : "error");
    setResult(res);
  };

  /** Общая отправка: учителю или от учителя. */
  const deliver = async (job: () => Promise<void>) => {
    setPost("busy");
    try {
      await job();
      haptic("success");
      setPost("sent");
    } catch (e) {
      haptic("error");
      const status = e instanceof ApiError ? e.status : 0;
      setPost(status === 413 ? "big" : status === 404 || status === 409 || status === 403 ? "gone" : "fail");
    }
  };

  const send = () => {
    const m = makeMeta();
    if (m && audio) void deliver(() => sendSubmission(student.id, m, audio));
  };

  const judge = () => {
    const m = makeMeta();
    if (m && review) void deliver(() => review.onVerdict(m, { marks, ...preview, comment: comment.trim() }));
  };

  const closedHint = teacherOnly || canSend ? "check_closedTeacher" : "check_closed";

  return (
    <div className="screen check" ref={top}>
      <header className="bar-top">
        <button className="ghost small" onClick={onClose}>
          <Icon name="back" size={16} /> {t("back")}
        </button>
        {!review?.sub && <span className="muted">{fmtDuration(timer.elapsed)}</span>}
      </header>
      <h2>
        {t(`check_${kind}` as const)}
        {review && `: ${student.name}`}
      </h2>
      <p className="hint">{t(review || (open && !teacherOnly) ? "checkHint" : open ? "check_naziraTeacher" : closedHint)}</p>
      {open && !teacherOnly && audio && <p className="hint muted">{t("aiSoon")}</p>}
      {review?.sub && (
        <section className="card">
          {url ? (
            <audio controls src={url} className="rec-audio" onError={() => setNoAudio(true)} />
          ) : (
            !noAudio && <p className="muted">{t("loading")}</p>
          )}
          {noAudio && <p role="alert">{t("review_noAudio")}</p>}
          {review.sub.peeks ? (
            <p className="muted">
              {t("check_peeks")}: {review.sub.peeks}
            </p>
          ) : null}
        </section>
      )}
      {teacherOnly && !canSend && <p className="card">{t("check_inPerson")}</p>}
      {!review && (!teacherOnly || canSend) && (
      <Recorder
        note={canSend ? t(teacherOnly ? "rec_noteTeacher" : "rec_noteEither") : undefined}
        watch={byHeart ? watch : undefined}
        onSilence={setOffer}
        onRecording={onRecording}
        onAudio={(b) => {
          setAudio(b);
          setAi(null);
        }}
      />
      )}
      {canSend && audio && (
        <section className="send-teacher">
          <button className="wide" onClick={send} disabled={post === "busy" || !data}>
            {t(post === "busy" ? "send_busy" : "send_teacher", { name: link!.teacher })}
          </button>
        </section>
      )}
      {post === "fail" && <p role="alert">{t("send_fail")}</p>}
      {post === "big" && <p role="alert">{t("send_big")}</p>}
      {post === "gone" && <p role="alert">{t(review ? "send_goneTeacher" : "send_gone")}</p>}
      {!open && !recording && !teacherOnly && (
        <button className="ghost" onClick={() => setOpen(true)}>
          {t(canSend && audio ? "check_self" : "check_open")}
        </button>
      )}
      {audio && open && !teacherOnly && (
        <section className="ai-check">
          <button className={review ? "ghost" : ""} onClick={checkAi} disabled={ai?.state === "busy" || !data}>
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
            onWord={open && !teacherOnly ? toggle : undefined}
          />
        </div>
      ))}

      {review && (
        <label className="comment">
          {t("review_comment")}
          <textarea rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
        </label>
      )}

      {!(teacherOnly && open) && !(teacherOnly && !canSend) && <div className="check-bar">
        {open ? (
          <>
            <div className="check-sums">
              <span>
                {t("errors")}: <b className="err-text">{errors}</b>
              </span>
              <span>
                {t("notes")}: <b className="note-text">{notes}</b>
              </span>
              {byHeart && !review && (
                <span>
                  {t("check_peeks")}: <b>{peeks}</b>
                </span>
              )}
              <span>
                {t("grade")}: <b>{preview.grade}</b>
              </span>
            </div>
            {review ? (
              <button onClick={judge} disabled={!data || post === "busy"}>
                {t(post === "busy" ? "send_busy" : preview.passed ? "review_pass" : "review_fail")}
              </button>
            ) : (
              <button onClick={finish} disabled={!data || recording}>
                {t("finishCheck")}
              </button>
            )}
          </>
        ) : (
          <>
            <span className="muted">
              {t(peeking ? "check_peeking" : offer ? "check_offer" : recording ? "check_listening" : canSend ? (audio ? "check_sendNow" : "check_startTeacher") : "check_start")}
            </span>
            {offer && (
              <button onClick={peek}>
                {t("peek")}
              </button>
            )}
          </>
        )}
      </div>}

      {post === "sent" && (
        <div className="modal">
          <div className="modal-card">
            <h2>{t(review ? "review_sent" : "send_done")}</h2>
            <p className="muted">{review ? t("review_sentNote", { name: student.name }) : t("send_doneNote", { name: link?.teacher ?? "" })}</p>
            <button onClick={onClose}>{t("close")}</button>
          </div>
        </div>
      )}

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

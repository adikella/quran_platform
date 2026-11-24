import { useEffect, useRef, useState } from "react";
import { fmtDuration, useT } from "../hooks";
import { haptic } from "../telegram";

type Status = "idle" | "recording" | "done" | "denied" | "unsupported";

function pickMime(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((m) => MediaRecorder.isTypeSupported(m));
}

/**
 * Запись чтения с микрофона. Пока запись остаётся на устройстве: её можно прослушать.
 * Дальше её будет получать устаз или ИИ-проверка (см. ИИ-ПРОВЕРКА.md).
 */
export function Recorder() {
  const t = useT();
  const [status, setStatus] = useState<Status>(() =>
    typeof navigator.mediaDevices?.getUserMedia === "function" && typeof MediaRecorder !== "undefined" ? "idle" : "unsupported",
  );
  const [url, setUrl] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);

  useEffect(() => {
    if (status !== "recording") return;
    const started = Date.now();
    const id = setInterval(() => setSeconds((Date.now() - started) / 1000), 250);
    return () => clearInterval(id);
  }, [status]);

  useEffect(
    () => () => {
      rec.current?.state === "recording" && rec.current.stop();
      stream.current?.getTracks().forEach((tr) => tr.stop());
      if (url) URL.revokeObjectURL(url);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const start = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      chunks.current = [];
      const mime = pickMime();
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        s.getTracks().forEach((tr) => tr.stop());
        const blob = new Blob(chunks.current, { type: r.mimeType || mime || "audio/webm" });
        setUrl((old) => {
          if (old) URL.revokeObjectURL(old);
          return URL.createObjectURL(blob);
        });
        setStatus("done");
      };
      r.start();
      rec.current = r;
      setSeconds(0);
      setStatus("recording");
      haptic("tap");
    } catch {
      setStatus("denied");
    }
  };

  const stop = () => {
    rec.current?.stop();
    haptic("tap");
  };

  return (
    <section className="recorder card">
      <h3>{t("rec_title")}</h3>
      {status === "unsupported" && <p className="muted">{t("rec_unsupported")}</p>}
      {status === "denied" && (
        <>
          <p className="muted">{t("rec_denied")}</p>
          <button className="ghost" onClick={start}>
            {t("rec_start")}
          </button>
        </>
      )}
      {status === "idle" && <button onClick={start}>{t("rec_start")}</button>}
      {status === "recording" && (
        <div className="row">
          <span className="rec-time" aria-live="off">
            {fmtDuration(seconds)}
          </span>
          <button onClick={stop}>{t("rec_stop")}</button>
        </div>
      )}
      {status === "done" && url && (
        <>
          <audio controls src={url} className="rec-audio" />
          <button className="ghost" onClick={start}>
            {t("rec_again")}
          </button>
        </>
      )}
      {(status === "idle" || status === "done") && <p className="muted small-note">{t("rec_note")}</p>}
    </section>
  );
}

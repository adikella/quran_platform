import { useEffect, useState } from "react";
import { fmtDuration, useT } from "../hooks";
import { ApiError, deleteAccount, loginCode, signIn, signInByCode, signOut, useSync } from "../sync";
import { inTelegram } from "../telegram";

/** Кнопка с работой на сервере: пока идёт, нажать второй раз нельзя; не вышло: говорит об этом. */
export function useJob() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<"net" | "code" | null>(null);
  const job = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setFailed(e instanceof ApiError && e.status === 404 ? "code" : "net");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, failed, job };
}

export function LoginByCode({ onDone }: { onDone?: () => void }) {
  const t = useT();
  const [code, setCode] = useState("");
  const { busy, failed, job } = useJob();
  return (
    <form
      className="code-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await job(() => signInByCode(code))) onDone?.();
      }}
    >
      <label>
        {t("acc_codeLabel")}
        <input className="code-input" value={code} autoComplete="off" autoCapitalize="characters" onChange={(e) => setCode(e.target.value)} />
      </label>
      <p className="muted small-note">{t("acc_codeWhere")}</p>
      {failed && <p role="alert">{t(failed === "code" ? "acc_codeBad" : "net_fail")}</p>}
      <button disabled={busy || code.trim().length < 8}>{t("acc_codeEnter")}</button>
    </form>
  );
}

/** Код, чтобы войти в этот же аккаунт на другом телефоне или компьютере. */
export function LoginCode() {
  const t = useT();
  const { busy, failed, job } = useJob();
  const [code, setCode] = useState<{ text: string; until: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!code) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [code]);
  const left = code ? Math.max(0, (code.until - now) / 1000) : 0;
  return (
    <>
      {code && left > 0 && (
        <div className="code-box">
          <b dir="ltr">
            {code.text.slice(0, 4)} {code.text.slice(4)}
          </b>
          <span className="muted">{t("acc_codeLeft", { time: fmtDuration(left) })}</span>
        </div>
      )}
      {failed && <p role="alert">{t("net_fail")}</p>}
      <button
        className="ghost"
        disabled={busy}
        onClick={() =>
          job(async () => {
            const r = await loginCode();
            setNow(Date.now());
            setCode({ text: r.code, until: Date.now() + r.seconds * 1000 });
          })
        }
      >
        {t("acc_codeGet")}
      </button>
    </>
  );
}

/** Вход и хранение на сервере. */
export function AccountCard({ name }: { name: string }) {
  const t = useT();
  const { account, status } = useSync();
  const { busy, failed, job } = useJob();
  if (!account) {
    return (
      <section className="card">
        <h3>{t("acc_title")}</h3>
        <p className="muted">{t("acc_why")}</p>
        {failed && <p role="alert">{t("net_fail")}</p>}
        <button disabled={busy} onClick={() => job(() => signIn(name))}>
          {t(inTelegram ? "acc_signInTg" : "acc_signIn")}
        </button>
        <details className="more">
          <summary>{t("acc_have")}</summary>
          <LoginByCode />
        </details>
      </section>
    );
  }
  const said = { off: "acc_busy", busy: "acc_busy", ok: "acc_ok", offline: "acc_offline", error: "acc_error" } as const;
  return (
    <section className="card">
      <h3>{t("acc_title")}</h3>
      <p role="status">{t(said[status])}</p>
      <p className="muted">{t(account.telegram ? "acc_other" : "acc_otherNoTg")}</p>
      <LoginCode />
      <details className="more">
        <summary>{t("acc_leave")}</summary>
        <p className="muted">{t("acc_leaveNote")}</p>
        {failed && <p role="alert">{t("net_fail")}</p>}
        <div className="row">
          <button className="ghost" disabled={busy} onClick={() => job(signOut)}>
            {t("acc_signOut")}
          </button>
          <button
            className="ghost danger"
            disabled={busy}
            onClick={() => confirm(t("acc_deleteConfirm")) && job(deleteAccount)}
          >
            {t("acc_delete")}
          </button>
        </div>
      </details>
    </section>
  );
}

import { useEffect, useState } from "react";
import { useT } from "../hooks";
import {
  ApiError,
  deleteAccount,
  setLogin,
  signInTelegram,
  signOut,
  signOutOthers,
  startLogin,
  useSync,
  waitLogin,
} from "../sync";
import { inTelegram } from "../telegram";
import { Qr } from "./Qr";

/** Кнопка с работой на сервере: пока идёт, нажать второй раз нельзя; не вышло: говорит об этом. */
export function useJob() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<"net" | "gone" | null>(null);
  const job = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setFailed(null);
    try {
      await fn();
      return true;
    } catch (e) {
      setFailed(e instanceof ApiError && e.status === 404 ? "gone" : "net");
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, failed, job };
}

/** Вход через Telegram: внутри Telegram сразу, на сайте через подтверждение в боте. */
export function SignIn() {
  const t = useT();
  const { login } = useSync();
  const { busy, failed, job } = useJob();
  const [said, setSaid] = useState<"declined" | "expired" | null>(null);

  useEffect(() => {
    if (!login) return;
    let live = true;
    void (async () => {
      while (live) {
        let r: Awaited<ReturnType<typeof waitLogin>> | "net" = "net";
        try {
          r = await waitLogin(login);
        } catch {
          // Телефон ушёл в Telegram и связь прервалась: пробуем дальше, пока вход не устарел.
          if (Date.now() > login.until) r = "expired";
        }
        if (!live || r === "in") return;
        if (r === "declined" || r === "expired") {
          setSaid(r);
          setLogin(null);
          return;
        }
        if (r === "net") await new Promise((ok) => setTimeout(ok, 2000));
      }
    })();
    return () => {
      live = false;
    };
  }, [login]);

  if (!login) {
    return (
      <>
        {said && <p role="alert">{t(said === "declined" ? "login_declined" : "login_expired")}</p>}
        {failed && <p role="alert">{t("net_fail")}</p>}
        <button
          className="wide"
          disabled={busy}
          onClick={() => {
            setSaid(null);
            void job(inTelegram ? signInTelegram : startLogin);
          }}
        >
          {t("login_button")}
        </button>
      </>
    );
  }
  return (
    <div className="login-wait">
      <p>{t("login_how")}</p>
      <p className="login-number">
        <span className="muted">{t("login_number")}</span> <b>{login.number}</b>
      </p>
      <a className="button wide" href={login.link} target="_blank" rel="noopener">
        {t("login_open")}
      </a>
      <p className="muted small-note qr-note">{t("login_qr")}</p>
      <Qr text={login.link} label={t("login_qr")} />
      <p role="status" className="muted">
        {t("login_waiting")}
      </p>
      <button className="link" onClick={() => setLogin(null)}>
        {t("cancel")}
      </button>
    </div>
  );
}

/** Вход и хранение на сервере. */
export function AccountCard() {
  const t = useT();
  const { account, status } = useSync();
  const { busy, failed, job } = useJob();
  const [others, setOthers] = useState(false);
  if (!account) {
    return (
      <section className="card">
        <h3>{t("acc_title")}</h3>
        <p className="muted">{t("acc_why")}</p>
        <SignIn />
      </section>
    );
  }
  const said = { off: "acc_busy", busy: "acc_busy", ok: "acc_ok", offline: "acc_offline", error: "acc_error" } as const;
  return (
    <section className="card">
      <h3>{t("acc_title")}</h3>
      <p>{t("acc_who", { name: account.name })}</p>
      <p role="status" className="muted">
        {t(said[status])}
      </p>
      <p className="muted">{t("acc_other")}</p>
      <details className="more">
        <summary>{t("acc_leave")}</summary>
        <p className="muted">{t("acc_leaveNote")}</p>
        {failed && <p role="alert">{t("net_fail")}</p>}
        {others && <p role="status">{t("acc_othersDone")}</p>}
        <div className="row">
          <button className="ghost" disabled={busy} onClick={() => job(signOut)}>
            {t("acc_signOut")}
          </button>
          <button className="ghost" disabled={busy} onClick={async () => setOthers(await job(signOutOthers))}>
            {t("acc_others")}
          </button>
          <button className="ghost danger" disabled={busy} onClick={() => confirm(t("acc_deleteConfirm")) && job(deleteAccount)}>
            {t("acc_delete")}
          </button>
        </div>
      </details>
    </section>
  );
}

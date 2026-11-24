import { useState } from "react";
import { useT } from "../hooks";
import { findTeacher, joinTeacher, leaveTeacher, setConsent, setJoinCode, signIn, useSync } from "../sync";
import type { Student } from "../types";
import { useJob } from "./AccountCard";

function Consent({ on, set, disabled }: { on: boolean; set: (v: boolean) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <label className="check-row consent">
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => set(e.target.checked)} />
      <span>{t("join_consent")}</span>
    </label>
  );
}

/** Учитель ученика: записаться по коду, ждать подтверждения, разрешить записи голоса, уйти. */
export function TeacherCard({ student }: { student: Student }) {
  const t = useT();
  const { account, links, joinCode } = useSync();
  const link = links.find((l) => l.student === student.id);
  const [code, setCode] = useState(joinCode ?? "");
  const [found, setFound] = useState<string | null>(null);
  const [consent, setOk] = useState(false);
  const { busy, failed, job } = useJob();

  const alert = failed && <p role="alert">{t(failed === "code" ? "join_bad" : "net_fail")}</p>;

  if (link) {
    return (
      <section className="card">
        <h3>{t("join_title")}</h3>
        <p>{t(link.status === "active" ? "join_active" : "join_pending", { name: link.teacher })}</p>
        <Consent on={link.consent} disabled={busy} set={(v) => job(() => setConsent(student.id, v))} />
        {alert}
        <button
          className="link danger"
          disabled={busy}
          onClick={() => (link.status === "pending" || confirm(t("join_leaveConfirm"))) && job(() => leaveTeacher(student.id))}
        >
          {t(link.status === "active" ? "join_leave" : "join_cancel")}
        </button>
      </section>
    );
  }

  return (
    <section className="card">
      <h3>{t("join_title")}</h3>
      {found === null ? (
        <form
          className="code-form"
          onSubmit={(e) => {
            e.preventDefault();
            void job(async () => {
              // Учителя ищем под своим входом: без него ученику не к чему привязаться.
              if (!account) await signIn(student.name);
              setFound((await findTeacher(code)).name);
            });
          }}
        >
          <p className="muted">{t("join_how")}</p>
          <label>
            {t("join_code")}
            <input className="code-input" value={code} autoComplete="off" autoCapitalize="characters" onChange={(e) => setCode(e.target.value)} />
          </label>
          {alert}
          <button disabled={busy || code.trim().length < 6}>{t("join_find")}</button>
          {joinCode && (
            <button type="button" className="link" onClick={() => setJoinCode(null)}>
              {t("join_later")}
            </button>
          )}
        </form>
      ) : (
        <>
          <p>{t("join_to", { name: found, student: student.name })}</p>
          <p className="muted">{t("join_sees")}</p>
          <Consent on={consent} set={setOk} disabled={busy} />
          {alert}
          <div className="row">
            <button disabled={busy} onClick={() => job(() => joinTeacher(student.id, code, consent))}>
              {t("join_do")}
            </button>
            <button className="ghost" disabled={busy} onClick={() => setFound(null)}>
              {t("cancel")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

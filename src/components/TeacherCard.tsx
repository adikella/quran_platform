import { useEffect, useState } from "react";
import { useT } from "../hooks";
import { useAppState } from "../store";
import { ApiError, findInvite, joinTeacher, leaveTeacher, setConsent, setJoinCode, useSync, type Invite } from "../sync";
import type { Student } from "../types";
import { SignIn, useJob } from "./AccountCard";

function Consent({ on, set, disabled, partner }: { on: boolean; set: (v: boolean) => void; disabled?: boolean; partner?: boolean }) {
  const t = useT();
  return (
    <label className="check-row consent">
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => set(e.target.checked)} />
      <span>{t(partner ? "mate_consent" : "join_consent")}</span>
    </label>
  );
}

/** Приглашение по ссылке группы: кто зовёт, кого записать, разрешение на запись голоса. */
export function InviteCard({ student, code }: { student: Student; code: string }) {
  const t = useT();
  const { students } = useAppState();
  const { account, links } = useSync();
  const [invite, setInvite] = useState<Invite | "bad" | "net" | null>(null);
  const [who, setWho] = useState(student.id);
  const [consent, setOk] = useState(false);
  const { busy, failed, job } = useJob();
  const signed = !!account;

  useEffect(() => {
    if (!signed) return;
    let live = true;
    setInvite(null);
    findInvite(code).then(
      (r) => live && setInvite(r),
      (e) => live && setInvite(e instanceof ApiError && e.status === 404 ? "bad" : "net"),
    );
    return () => {
      live = false;
    };
  }, [code, signed]);

  const old = links.find((l) => l.student === who);
  const ready = invite && typeof invite === "object" ? invite : null;

  return (
    <section className="card accent">
      <h3>{t("join_invite")}</h3>
      {!signed && (
        <>
          <p className="muted">{t("join_signIn")}</p>
          <SignIn />
        </>
      )}
      {signed && !invite && <p className="muted">{t("loading")}</p>}
      {invite === "bad" && <p role="alert">{t("join_bad")}</p>}
      {invite === "net" && <p role="alert">{t("net_fail")}</p>}
      {ready?.own && <p>{t("join_own")}</p>}
      {ready && !ready.own && (
        <>
          <p className="invite">
            <b>{ready.group}</b>
            <span>{t("join_by", { name: ready.teacher })}</span>
          </p>
          {students.length > 1 && (
            <label>
              {t("join_whom")}
              <select value={who} onChange={(e) => setWho(e.target.value)}>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {old && <p className="muted">{t("join_change", { name: old.teacher, group: old.group })}</p>}
          <p className="muted">{t("join_sees")}</p>
          <Consent on={consent} set={setOk} disabled={busy} />
          {failed && <p role="alert">{t(failed === "gone" ? "join_bad" : "net_fail")}</p>}
          <button className="wide" disabled={busy} onClick={() => job(() => joinTeacher(who, code, consent))}>
            {t("join_do")}
          </button>
        </>
      )}
      <button className="link" disabled={busy} onClick={() => setJoinCode(null)}>
        {t(ready && !ready.own ? "join_later" : "close")}
      </button>
    </section>
  );
}

/** Учитель ученика: ждать подтверждения, разрешить записи голоса, уйти. */
export function TeacherCard({ student }: { student: Student }) {
  const t = useT();
  const { links } = useSync();
  const link = links.find((l) => l.student === student.id);
  const { busy, failed, job } = useJob();
  return (
    <section className="card">
      <h3>{t("join_title")}</h3>
      {!link && <p className="muted">{t("join_how")}</p>}
      {link && (
        <>
          <p>{t(link.status === "active" ? "join_active" : "join_pending", { name: link.teacher, group: link.group })}</p>
          <Consent on={link.consent} disabled={busy} set={(v) => job(() => setConsent(student.id, { consent: v }))} />
          {link.partner && (
            <>
              <p>{t("mate_yours", { name: link.partner })}</p>
              {link.consent ? (
                <Consent partner on={link.partnerConsent} disabled={busy} set={(v) => job(() => setConsent(student.id, { partnerConsent: v }))} />
              ) : (
                <p className="muted">{t("mate_consentFirst")}</p>
              )}
            </>
          )}
          {failed && <p role="alert">{t("net_fail")}</p>}
          <button
            className="link danger"
            disabled={busy}
            onClick={() => (link.status === "pending" || confirm(t("join_leaveConfirm"))) && job(() => leaveTeacher(student.id))}
          >
            {t(link.status === "active" ? "join_leave" : "join_cancel")}
          </button>
        </>
      )}
    </section>
  );
}

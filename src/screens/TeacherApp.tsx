import { useEffect, useState } from "react";
import { AccountCard, useJob } from "../components/AccountCard";
import { InstallCard } from "../components/InstallCard";
import { Qr } from "../components/Qr";
import { useMeta, useSurahs, useT } from "../hooks";
import { LANG_NAMES, type Key } from "../i18n";
import { Icon, type IconName } from "../icons";
import { revision, todayKey } from "../method";
import { verseSpanLabel } from "../mushaf";
import { setLang, setRole, setTheme, useAppState } from "../store";
import {
  answerRequest,
  checkInPerson,
  createGroup,
  deleteGroup,
  expelStudent,
  moveStudent,
  refreshBox,
  renameGroup,
  renameMe,
  renewGroupLink,
  sendVerdict,
  useSync,
  type Group,
  type RemoteSub,
  type TeacherBox,
} from "../sync";
import type { Lang, LineRange, MushafMeta, Student, SubmissionKind, Theme } from "../types";
import { CheckScreen } from "./CheckScreen";
import { JournalScreen } from "./JournalScreen";
import { ProgressScreen } from "./ProgressScreen";
import { rangeText, rangesText } from "./TodayScreen";

type Tab = "inbox" | "group" | "settings";
const TABS: Tab[] = ["inbox", "group", "settings"];
const KINDS: SubmissionKind[] = ["sabak", "sabki", "manzil"];

type Pupil = TeacherBox["students"][number];
interface Check {
  student: Student;
  kind: SubmissionKind;
  ranges: LineRange[];
  groups?: number;
  sub?: RemoteSub;
}

export function TeacherApp() {
  const t = useT();
  const { box, boxFailed, account } = useSync();
  const [tab, setTab] = useState<Tab>("inbox");
  const [pupil, setPupil] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [check, setCheck] = useState<Check | null>(null);

  // Пока кабинет открыт, новые сдачи приходят сами; во время проверки список не трогаем.
  const idle = !check;
  useEffect(() => {
    if (!idle) return;
    void refreshBox();
    const look = () => document.visibilityState === "visible" && void refreshBox();
    const id = setInterval(look, 20_000);
    document.addEventListener("visibilitychange", look);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", look);
    };
  }, [idle, account?.id]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab, pupil, check]);

  if (check) return <TeacherCheck check={check} onClose={() => setCheck(null)} />;

  const open = box?.students.find((s) => s.data.id === pupil);
  if (open) {
    return <PupilScreen pupil={open} groups={box!.groups} inbox={box!.inbox.filter((x) => x.student === open.data.id)} onCheck={setCheck} onClose={() => setPupil(null)} />;
  }

  return (
    <div className="app">
      <header className="app-head">
        <span className="brand">{t("cab_title")}</span>
        <span className="who">{account?.name}</span>
      </header>
      <main>
        {tab !== "settings" && !box && <p className="muted pad">{t(boxFailed ? "net_fail" : "loading")}</p>}
        {tab !== "settings" && box && boxFailed && <p className="pad" role="alert">{t("cab_stale")}</p>}
        {tab === "inbox" && box && <Inbox box={box} onCheck={setCheck} goGroup={() => setTab("group")} />}
        {tab === "group" && box && <GroupTab box={box} group={group} setGroup={setGroup} onOpen={setPupil} />}
        {tab === "settings" && <TeacherSettings />}
      </main>
      <nav className="tabs tabs-3">
        {TABS.map((k) => (
          <button key={k} className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}>
            <span className="ico">
              <Icon name={k as IconName} />
              {k === "inbox" && box && box.inbox.length + box.requests.length > 0 && <b className="count">{box.inbox.length + box.requests.length}</b>}
            </span>
            <span>{t(`cab_${k}` as Key)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function TeacherCheck({ check, onClose }: { check: Check; onClose: () => void }) {
  const t = useT();
  const meta = useMeta(check.student.mushaf);
  if (!meta) return <p className="muted pad">{t("loading")}</p>;
  return (
    <CheckScreen
      student={check.student}
      kind={check.kind}
      ranges={check.ranges}
      groups={check.groups}
      meta={meta}
      onClose={onClose}
      review={{
        sub: check.sub,
        onVerdict: (m, v) => (check.sub ? sendVerdict(check.sub.id, v) : checkInPerson(check.student.id, m, v)),
      }}
    />
  );
}

/** «Сегодня 14:20» или «24 нояб. 14:20». */
function useWhen() {
  const t = useT();
  const { lang } = useAppState();
  return (sec: number) => {
    const d = new Date(sec * 1000);
    const time = d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });
    if (todayKey(d) === todayKey()) return `${t("cab_today")} ${time}`;
    return `${d.toLocaleDateString(lang === "kk" ? "kk-KZ" : lang, { day: "numeric", month: "short" })} ${time}`;
  };
}

function Inbox({ box, onCheck, goGroup }: { box: TeacherBox; onCheck: (c: Check) => void; goGroup: () => void }) {
  const t = useT();
  return (
    <div className="screen">
      <Requests box={box} />
      {!box.inbox.length && !box.requests.length && (
        <div className="empty">
          <p>{t(box.students.length ? "cab_empty" : "cab_noStudents")}</p>
          {!box.students.length && <button onClick={goGroup}>{t("cab_invite")}</button>}
        </div>
      )}
      <SubList box={box} subs={box.inbox} onCheck={onCheck} />
    </div>
  );
}

function SubList({ box, subs, onCheck }: { box: TeacherBox | Pupil[]; subs: RemoteSub[]; onCheck: (c: Check) => void }) {
  const t = useT();
  const when = useWhen();
  const surahs = useSurahs();
  const { lang } = useAppState();
  const pupils = Array.isArray(box) ? box : box.students;
  const groups = Array.isArray(box) ? [] : box.groups;
  if (!subs.length) return null;
  return (
    <ul className="list">
      {subs.map((s) => {
        const p = pupils.find((x) => x.data.id === s.student);
        if (!p) return null;
        return (
          <li key={s.id}>
            <button className="list-row" onClick={() => onCheck({ student: p.data, kind: s.kind, ranges: s.ranges, groups: s.groups, sub: s })}>
              <span className="list-main">
                <b>{p.data.name}</b>
                {groups.length > 1 && <span className="muted">{groups.find((g) => g.id === p.group)?.name}</span>}
                <span>
                  {t(`kind_${s.kind}` as Key)}, {verseSpanLabel(s.fromVerse, s.toVerse, surahs, lang)}
                </span>
              </span>
              <span className="muted">{when(s.created)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Requests({ box }: { box: TeacherBox }) {
  const t = useT();
  const { busy, failed, job } = useJob();
  if (!box.requests.length) return null;
  return (
    <section className="card accent">
      <h3>{t("cab_requests")}</h3>
      {failed && <p role="alert">{t("net_fail")}</p>}
      {box.requests.map((r) => (
        <div key={r.id} className="request">
          <span className="list-main">
            <b>{r.name}</b>
            {box.groups.length > 1 && <span className="muted">{box.groups.find((g) => g.id === r.group)?.name}</span>}
          </span>
          <div className="row">
            <button className="small" disabled={busy} onClick={() => job(() => answerRequest(r.id, true))}>
              {t("cab_accept")}
            </button>
            <button className="small ghost" disabled={busy} onClick={() => job(() => answerRequest(r.id, false))}>
              {t("cab_decline")}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}

/** Что сегодня сдано: по строке на вид сдачи. */
function TodayMarks({ s }: { s: Student }) {
  const t = useT();
  const today = todayKey();
  const kinds: SubmissionKind[] = s.stage === "nazira" ? ["nazira"] : KINDS;
  return (
    <span className="marks">
      {kinds.map((k) => {
        const sub = [...s.submissions].reverse().find((x) => x.kind === k && x.date === today);
        return (
          <span key={k} className={`pill ${sub ? (sub.passed ? "ok" : "bad") : "none"}`}>
            {t(`kind_${k}` as Key)}
            {sub ? `: ${sub.grade}` : ""}
          </span>
        );
      })}
    </span>
  );
}

function Where({ s }: { s: Student }) {
  const t = useT();
  const meta = useMeta(s.mushaf);
  if (!meta) return <span className="muted">{t("loading")}</span>;
  const lines = (p: number) => meta.page[p - 1][3];
  const h = s.hifz;
  if (s.stage === "nazira") return <span>{t("cab_reads", { p: s.nazira.next })}</span>;
  if (h.pending) return <span>{t("cab_ready", { r: rangeText(h.pending, lines(h.pending.page), t) })}</span>;
  if (h.lesson) return <span>{t("cab_learning", { r: rangeText(h.lesson.range, lines(h.lesson.range.page), t) })}</span>;
  return <span>{t("cab_next", { p: h.cur.page })}</span>;
}

/** Одна группа: ссылка, QR, переименовать, новая ссылка, удалить пустую. */
function GroupCard({ group, empty, only }: { group: Group; empty: boolean; only: boolean }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState(false);
  const [name, setName] = useState(group.name);
  const { busy, failed, job } = useJob();
  return (
    <section className="card">
      <h3>{group.name}</h3>
      <p className="muted">{t("grp_note")}</p>
      <div className="row">
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(group.link);
              setCopied(true);
            } catch {
              prompt(t("cab_copy"), group.link);
            }
          }}
        >
          {t(copied ? "cab_copied" : "cab_copy")}
        </button>
        <button className="ghost" aria-expanded={qr} onClick={() => setQr(!qr)}>
          {t(qr ? "grp_hideQr" : "grp_qr")}
        </button>
      </div>
      {qr && <Qr text={group.link} label={`${t("grp_qr")}: ${group.name}`} />}
      <details className="more">
        <summary>{t("grp_more")}</summary>
        <form
          className="code-form"
          onSubmit={(e) => {
            e.preventDefault();
            void job(() => renameGroup(group.id, name.trim()));
          }}
        >
          <label>
            {t("grp_name")}
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          {failed && <p role="alert">{t("net_fail")}</p>}
          {name.trim() && name.trim() !== group.name && <button disabled={busy}>{t("save")}</button>}
        </form>
        <button
          className="link"
          disabled={busy}
          onClick={async () => {
            if (confirm(t("grp_renewConfirm")) && (await job(() => renewGroupLink(group.id)))) setCopied(false);
          }}
        >
          {t("grp_renew")}
        </button>
        {!only &&
          (empty ? (
            <p>
              <button className="link danger" disabled={busy} onClick={() => job(() => deleteGroup(group.id))}>
                {t("grp_delete")}
              </button>
            </p>
          ) : (
            <p className="muted small-note">{t("grp_deleteNote")}</p>
          ))}
      </details>
    </section>
  );
}

function GroupTab({
  box,
  group,
  setGroup,
  onOpen,
}: {
  box: TeacherBox;
  group: string | null;
  setGroup: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const t = useT();
  const when = useWhen();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const { busy, failed, job } = useJob();
  const cur = box.groups.find((g) => g.id === group) ?? box.groups[0];
  const pupils = cur ? box.students.filter((p) => p.group === cur.id) : [];
  const asking = cur ? box.requests.filter((r) => r.group === cur.id) : [];
  return (
    <div className="screen">
      <Requests box={box} />
      <div className="groups">
        {box.groups.map((g) => (
          <button key={g.id} className={`chip ${g.id === cur?.id ? "on" : ""}`} aria-pressed={g.id === cur?.id} onClick={() => setGroup(g.id)}>
            {g.name} ({box.students.filter((p) => p.group === g.id).length})
          </button>
        ))}
        <button className="link" aria-expanded={adding} onClick={() => setAdding(!adding)}>
          {t("grp_add")}
        </button>
      </div>
      {adding && (
        <form
          className="card form"
          onSubmit={(e) => {
            e.preventDefault();
            void job(async () => {
              setGroup((await createGroup(name.trim())).id);
              setName("");
              setAdding(false);
            });
          }}
        >
          <label>
            {t("grp_name")}
            <input value={name} maxLength={80} placeholder={t("grp_namePh")} onChange={(e) => setName(e.target.value)} />
          </label>
          {failed && <p role="alert">{t("net_fail")}</p>}
          <button disabled={busy || !name.trim()}>{t("grp_create")}</button>
        </form>
      )}
      {cur && <GroupCard key={`${cur.id}${cur.link}`} group={cur} empty={!pupils.length && !asking.length} only={box.groups.length === 1} />}
      {cur && !pupils.length && <p className="muted">{t("cab_noStudents")}</p>}
      {pupils.length > 0 && (
        <ul className="list">
          {pupils.map((p) => (
            <li key={p.data.id}>
              <button className="list-row col" onClick={() => onOpen(p.data.id)}>
                <span className="list-top">
                  <b>{p.data.name}</b>
                  <span className="muted">{when(p.updated)}</span>
                </span>
                <Where s={p.data} />
                <TodayMarks s={p.data} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function todaysWork(s: Student, meta: MushafMeta): Check[] {
  const lines = (p: number) => meta.page[p - 1][3];
  if (s.stage === "nazira") return [{ student: s, kind: "nazira", ranges: [{ page: s.nazira.next, from: 0, to: lines(s.nazira.next) }] }];
  const rev = revision(s, meta);
  const out: Check[] = [];
  if (s.hifz.pending) out.push({ student: s, kind: "sabak", ranges: [s.hifz.pending] });
  if (rev.sabki.length) out.push({ student: s, kind: "sabki", ranges: rev.sabki });
  if (rev.manzilToday.length) {
    out.push({
      student: s,
      kind: "manzil",
      ranges: rev.manzilToday.flatMap((g) => g.ranges),
      groups: rev.manzilToday.length,
    });
  }
  return out;
}

function PupilScreen({
  pupil,
  groups,
  inbox,
  onCheck,
  onClose,
}: {
  pupil: Pupil;
  groups: Group[];
  inbox: RemoteSub[]; onCheck: (c: Check) => void; onClose: () => void }) {
  const t = useT();
  const when = useWhen();
  const s = pupil.data;
  const meta = useMeta(s.mushaf);
  const [part, setPart] = useState<"journal" | "progress">("journal");
  const { busy, failed, job } = useJob();
  const day = s.days[todayKey()];
  return (
    <div className="app no-tabs">
      <div className="screen">
        <header className="bar-top">
          <button className="ghost small" onClick={onClose}>
            <Icon name="back" size={16} /> {t("cab_group")}
          </button>
          <span className="muted">{when(pupil.updated)}</span>
        </header>
        <h2>{s.name}</h2>
        <p className="pupil-now">
          <Where s={s} />
        </p>
        <TodayMarks s={s} />
        <p className="muted">
          {t("cab_reps", { n: day?.reps ?? 0 })}
          {pupil.consent ? "" : ` ${t("cab_noConsent")}`}
        </p>

        <SubList box={[pupil]} subs={inbox} onCheck={onCheck} />

        <section className="card">
          <h3>{t("cab_hear")}</h3>
          <p className="muted">{t("cab_hearNote")}</p>
          {meta &&
            (todaysWork(s, meta).length ? (
              <div className="hear">
                {todaysWork(s, meta).map((c) => (
                  <button key={c.kind} className="ghost" onClick={() => onCheck(c)}>
                    <b>{t(`kind_${c.kind}` as Key)}</b>
                    <span>{rangesText(c.ranges, (p) => meta.page[p - 1][3], t)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">{t("nothingYet")}</p>
            ))}
        </section>

        <div className="switch" role="tablist">
          {(["journal", "progress"] as const).map((k) => (
            <button key={k} role="tab" aria-selected={part === k} className={part === k ? "on" : ""} onClick={() => setPart(k)}>
              {t(`tab_${k}`)}
            </button>
          ))}
        </div>
      </div>
      {part === "journal" ? <JournalScreen student={s} /> : <ProgressScreen student={s} />}
      <div className="screen">
        {failed && <p role="alert">{t("net_fail")}</p>}
        {groups.length > 1 && (
          <label>
            {t("cab_group")}
            <select value={pupil.group} disabled={busy} onChange={(e) => job(() => moveStudent(s.id, e.target.value))}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          className="link danger"
          disabled={busy}
          onClick={async () => {
            if (confirm(t("cab_expelConfirm", { name: s.name })) && (await job(() => expelStudent(s.id)))) onClose();
          }}
        >
          {t("cab_expel")}
        </button>
      </div>
    </div>
  );
}

function TeacherSettings() {
  const t = useT();
  const app = useAppState();
  const { account } = useSync();
  const [name, setName] = useState(account?.name ?? "");
  const { busy, failed, job } = useJob();
  return (
    <div className="screen">
      <section className="card form">
        <label>
          {t("cab_name")}
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        {failed && <p role="alert">{t("net_fail")}</p>}
        {name.trim() && name.trim() !== account?.name && (
          <button disabled={busy} onClick={() => job(() => renameMe(name.trim()))}>
            {t("save")}
          </button>
        )}
        <label>
          {t("chooseLang")}
          <select value={app.lang} onChange={(e) => setLang(e.target.value as Lang)}>
            {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
              <option key={l} value={l}>
                {LANG_NAMES[l]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("theme")}
          <select value={app.theme ?? "auto"} onChange={(e) => setTheme(e.target.value as Theme)}>
            {(["auto", "light", "dark"] as Theme[]).map((v) => (
              <option key={v} value={v}>
                {t(`theme_${v}` as Key)}
              </option>
            ))}
          </select>
        </label>
      </section>
      <AccountCard />
      <section className="card">
        <h3>{t("cab_selfTitle")}</h3>
        <p className="muted">{t("cab_selfNote")}</p>
        <button className="ghost" onClick={() => setRole("student")}>
          {t("cab_self")}
        </button>
      </section>
      <InstallCard />
    </div>
  );
}

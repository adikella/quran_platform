import { useEffect, useState } from "react";
import { useMeta, useT } from "./hooks";
import type { Key } from "./i18n";
import { Icon } from "./icons";
import { CheckScreen } from "./screens/CheckScreen";
import { JournalScreen } from "./screens/JournalScreen";
import { LessonScreen } from "./screens/LessonScreen";
import { MushafScreen } from "./screens/MushafScreen";
import { Onboarding } from "./screens/Onboarding";
import { ProgressScreen } from "./screens/ProgressScreen";
import { ReadScreen } from "./screens/ReadScreen";
import { ResultScreen } from "./screens/ResultScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { TeacherApp } from "./screens/TeacherApp";
import { TodayScreen, type Nav } from "./screens/TodayScreen";
import { activeStudent, useAppState } from "./store";
import { useSync } from "./sync";
import { telegramTheme } from "./telegram";

type Tab = "today" | "mushaf" | "journal" | "progress" | "settings";
const TABS: Tab[] = ["today", "mushaf", "journal", "progress", "settings"];

export function App() {
  const app = useAppState();
  const t = useT();
  const student = activeStudent(app);
  const [tab, setTab] = useState<Tab>("today");
  const [nav, setNav] = useState<Nav | null>(null);
  const [adding, setAdding] = useState(false);
  const [mushafPage, setMushafPage] = useState(() => student?.bookmark ?? 1);
  const meta = useMeta(student?.mushaf ?? "madani");
  const { account, links } = useSync();

  useEffect(() => {
    const root = document.documentElement;
    const theme = app.theme ?? "auto";
    const forced = theme === "auto" ? telegramTheme() : theme;
    if (forced) root.dataset.theme = forced;
    else delete root.dataset.theme;
  }, [app.theme]);

  useEffect(() => {
    document.documentElement.lang = app.lang;
    document.documentElement.dir = app.lang === "ar" ? "rtl" : "ltr";
    document.title = t("appName");
  }, [app.lang, t]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab, nav]);

  // Без входа кабинета нет: вышедший учитель видит обычный первый экран.
  if (app.role === "teacher" && account?.role === "teacher") return <TeacherApp />;

  if (!student || adding) {
    return <Onboarding onDone={() => setAdding(false)} onCancel={student ? () => setAdding(false) : undefined} />;
  }

  const close = () => setNav(null);

  if (nav?.name === "lesson") {
    return <LessonScreen student={student} onClose={close} onSubmitNow={() => {
      const pending = activeStudent()?.hifz.pending;
      setNav(pending ? { name: "check", kind: "sabak", ranges: [pending] } : null);
    }} />;
  }
  if (nav?.name === "result") return <ResultScreen student={student} sub={nav.sub} onClose={close} />;
  if (nav?.name === "check" && meta) {
    return (
      <CheckScreen
        student={student}
        kind={nav.kind}
        ranges={nav.ranges}
        groups={nav.groups}
        meta={meta}
        onClose={close}
        link={links.find((l) => l.student === student.id && l.status === "active")}
      />
    );
  }
  if (nav?.name === "read") {
    const titles: Record<string, Key> = { nazira: "naziraToday", sabki: "col_sabki", manzil: "col_manzil", sabak: "col_sabak" };
    const submitKey: Record<string, Key> = { nazira: "naziraSubmit", sabki: "sabkiSubmit", manzil: "manzilSubmit", sabak: "sabakSubmit" };
    return (
      <ReadScreen
        student={student}
        title={t(titles[nav.kind])}
        ranges={nav.ranges}
        category={nav.kind}
        until={nav.kind === "sabki" || nav.kind === "manzil" ? student.method.morningEnd : undefined}
        onClose={close}
        onSubmit={() => setNav({ ...nav, name: "check" })}
        submitLabel={t(submitKey[nav.kind])}
        target={nav.kind === "nazira" ? student.method.readFirst : undefined}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-head">
        <span className="brand">{t("appName")}</span>
        <span className="who">{student.name}</span>
      </header>
      <main>
        {tab === "today" && <TodayScreen student={student} go={setNav} />}
        {tab === "mushaf" && <MushafScreen mushaf={student.mushaf} page={mushafPage} setPage={setMushafPage} />}
        {tab === "journal" && <JournalScreen student={student} onOpen={(sub) => setNav({ name: "result", sub })} />}
        {tab === "progress" && (
          <ProgressScreen
            edit
            student={student}
            openPage={(p) => {
              setMushafPage(p);
              setTab("mushaf");
            }}
          />
        )}
        {tab === "settings" && <SettingsScreen student={student} onAddStudent={() => setAdding(true)} />}
      </main>
      <nav className="tabs">
        {TABS.map((k) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
            <span className="ico">
              <Icon name={k} />
            </span>
            <span>{t(`tab_${k}` as Key)}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

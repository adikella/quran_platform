import { useRef } from "react";
import { LANG_NAMES, type Key } from "../i18n";
import { useT } from "../hooks";
import {
  exportJson,
  importJson,
  patchStudent,
  removeStudent,
  setActive,
  setLang,
  setTheme,
  useAppState,
} from "../store";
import type { Lang, Method, Stage, Student, Theme, Volume } from "../types";

const NUMBER_FIELDS: (keyof Method)[] = [
  "readFirst",
  "look",
  "blind",
  "heart",
  "join",
  "whole",
  "dailyTarget",
  "maxErrors",
  "sabkiPages",
  "manzilJuz",
  "naziraJuz",
  "sessionMinutes",
];

export function SettingsScreen({ student, onAddStudent }: { student: Student; onAddStudent: () => void }) {
  const t = useT();
  const app = useAppState();
  const file = useRef<HTMLInputElement>(null);
  const m = student.method;
  const setMethod = (patch: Partial<Method>) => patchStudent(student.id, { method: { ...m, ...patch } });

  const download = () => {
    const blob = new Blob([exportJson()], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `quran-platform-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="screen">
      <section className="card">
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

      <section className="card">
        <h3>{t("students")}</h3>
        <div className="choices col">
          {app.students.map((s) => (
            <button key={s.id} className={`choice ${s.id === student.id ? "on" : ""}`} onClick={() => setActive(s.id)}>
              <b>{s.name}</b>
              <span className="muted">
                {t(s.mushaf)} · {t(`stage_${s.stage}` as const)}
              </span>
            </button>
          ))}
        </div>
        <button className="ghost" onClick={onAddStudent}>
          + {t("addStudent")}
        </button>
      </section>

      <section className="card form">
        <label>
          {t("yourName")}
          <input value={student.name} onChange={(e) => patchStudent(student.id, { name: e.target.value })} />
        </label>
        <p className="muted">
          {t("chooseMushaf")}: <b>{t(student.mushaf)}</b>. {t("mushafLocked")}
        </p>
        <label>
          {t("stage")}
          <select value={student.stage} onChange={(e) => patchStudent(student.id, { stage: e.target.value as Stage })}>
            {(["nazira", "hifz"] as Stage[]).map((v) => (
              <option key={v} value={v}>
                {t(`stage_${v}` as const)}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small-note">{t("stageNote")}</p>
        <label>
          {t("volume")}
          <select value={student.volume} onChange={(e) => patchStudent(student.id, { volume: e.target.value as Volume })}>
            {(["lines2", "half", "page"] as Volume[]).map((v) => (
              <option key={v} value={v}>
                {t(`vol_${v}` as const)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("direction")}
          <select
            value={student.direction}
            onChange={(e) => patchStudent(student.id, { direction: Number(e.target.value) as 1 | -1 })}
          >
            <option value={1}>{t("dir_forward")}</option>
            <option value={-1}>{t("dir_backward")}</option>
          </select>
        </label>
      </section>

      <section className="card form">
        <h3>{t("method")}</h3>
        {NUMBER_FIELDS.map((k) => (
          <label key={k} className="num">
            <span>{t(`m_${k}` as Key)}</span>
            <input
              type="number"
              min={0}
              value={m[k] as number}
              onChange={(e) => setMethod({ [k]: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
        ))}
        <label className="check-row">
          <input type="checkbox" checked={m.heartSplit} onChange={(e) => setMethod({ heartSplit: e.target.checked })} />
          <span>{t("m_heartSplit")}</span>
        </label>
        <label className="num">
          <span>{t("m_morningStart")}</span>
          <input type="time" value={m.morningStart} onChange={(e) => setMethod({ morningStart: e.target.value })} />
        </label>
        <label className="num">
          <span>{t("m_morningEnd")}</span>
          <input type="time" value={m.morningEnd} onChange={(e) => setMethod({ morningEnd: e.target.value })} />
        </label>
      </section>

      <section className="card">
        <h3>{t("data")}</h3>
        <div className="row">
          <button className="ghost" onClick={download}>
            {t("exportData")}
          </button>
          <button className="ghost" onClick={() => file.current?.click()}>
            {t("importData")}
          </button>
        </div>
        <input
          ref={file}
          type="file"
          accept="application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              importJson(await f.text());
            } catch {
              alert("Error");
            }
            e.target.value = "";
          }}
        />
        <button
          className="link danger"
          onClick={() => {
            if (confirm(t("confirmReset"))) removeStudent(student.id);
          }}
        >
          {t("resetStudent")}
        </button>
      </section>

      <p className="muted small-print">{t("sources")}</p>
    </div>
  );
}

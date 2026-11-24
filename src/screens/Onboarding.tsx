import { useState } from "react";
import { LANG_NAMES } from "../i18n";
import { useMeta, useT } from "../hooks";
import { addStudent, importJson, setLang, useAppState } from "../store";
import type { Lang, MushafId, Stage, Volume } from "../types";
import { StartPicker } from "./TodayScreen";

/** Первый запуск или новый ученик: язык, имя, мусхаф, этап, объём урока. */
export function Onboarding({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const t = useT();
  const { lang } = useAppState();
  const [name, setName] = useState("");
  const [mushaf, setMushaf] = useState<MushafId>("madani");
  const [stage, setStage] = useState<Stage>("nazira");
  const [volume, setVolume] = useState<Volume>("lines2");
  const [page, setPage] = useState(1);
  const [dir, setDir] = useState<1 | -1>(1);
  const meta = useMeta(mushaf);

  const [paste, setPaste] = useState("");
  const [pasteBad, setPasteBad] = useState(false);
  const first = !onCancel;

  const create = () => {
    addStudent({ name, mushaf, stage, volume, direction: dir, startPage: stage === "nazira" ? 1 : page });
    onDone();
  };

  return (
    <div className="screen onboarding">
      <h1>{t("appName")}</h1>
      <p className="muted">{t("welcome")}</p>

      <section className="card">
        <h3>{t("chooseLang")}</h3>
        <div className="choices">
          {(Object.keys(LANG_NAMES) as Lang[]).map((l) => (
            <button key={l} className={`choice ${lang === l ? "on" : ""}`} onClick={() => setLang(l)}>
              {LANG_NAMES[l]}
            </button>
          ))}
        </div>
      </section>

      {first && (
        <details className="card transfer">
          <summary>{t("transfer_title")}</summary>
          <p className="muted">{t("transfer_how")}</p>
          <textarea
            rows={3}
            value={paste}
            aria-label={t("transfer_title")}
            onChange={(e) => {
              setPaste(e.target.value);
              setPasteBad(false);
            }}
          />
          {pasteBad && <p role="alert">{t("transfer_bad")}</p>}
          <button
            disabled={!paste.trim()}
            onClick={() => {
              try {
                importJson(paste.trim());
                onDone();
              } catch {
                setPasteBad(true);
              }
            }}
          >
            {t("transfer_do")}
          </button>
        </details>
      )}

      <section className="card">
        <label>
          {t("yourName")}
          <input value={name} placeholder={t("namePh")} onChange={(e) => setName(e.target.value)} />
        </label>
      </section>

      <section className="card">
        <h3>{t("chooseMushaf")}</h3>
        <div className="choices col">
          {(["madani", "indopak"] as MushafId[]).map((m) => (
            <button
              key={m}
              className={`choice ${mushaf === m ? "on" : ""}`}
              onClick={() => {
                setMushaf(m);
                setPage(1);
                setDir(1);
              }}
            >
              <b>{t(m)}</b>
              <span className="muted">{t(`${m}Desc` as const)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>{t("chooseStage")}</h3>
        <div className="choices col">
          {(["nazira", "hifz"] as Stage[]).map((s) => (
            <button key={s} className={`choice ${stage === s ? "on" : ""}`} onClick={() => setStage(s)}>
              <b>{t(`stage_${s}` as const)}</b>
              <span className="muted">{t(`stage_${s}Desc` as const)}</span>
            </button>
          ))}
        </div>
        {stage === "hifz" && meta && <StartPicker meta={meta} page={page} setPage={setPage} dir={dir} setDir={setDir} />}
      </section>

      <section className="card">
        <h3>{t("volume")}</h3>
        <div className="choices">
          {(["lines2", "half", "page"] as Volume[]).map((v) => (
            <button key={v} className={`choice ${volume === v ? "on" : ""}`} onClick={() => setVolume(v)}>
              {t(`vol_${v}` as const)}
            </button>
          ))}
        </div>
      </section>

      <button className="wide" onClick={create}>
        {t("start")}
      </button>
      {onCancel && (
        <button className="ghost wide" onClick={onCancel}>
          {t("cancel")}
        </button>
      )}
    </div>
  );
}

import { useState } from "react";
import { useSurahs, useT } from "../hooks";
import { addRange, coverage, firstFree, juzPages, juzRanges, juzSurahs, learnedOf, linesOn, removeRange, type Learned } from "../learned";
import { surahName } from "../mushaf";
import { setLearned, useAppState } from "../store";
import type { LineRange, MushafMeta, Student } from "../types";

const ALL_JUZ = Array.from({ length: 30 }, (_, i) => i + 1);

/** Что выучено: джузы одним нажатием, внутри джуза суры и страницы. */
export function LearnedPicker({
  meta,
  value,
  onChange,
  direction,
}: {
  meta: MushafMeta;
  value: Learned;
  onChange: (l: Learned) => void;
  direction: 1 | -1;
}) {
  const t = useT();
  const surahs = useSurahs();
  const { lang } = useAppState();
  const [count, setCount] = useState("");
  const [from, setFrom] = useState<1 | -1>(direction);
  const [juz, setJuz] = useState(direction === 1 ? 1 : 30);

  const toggle = (ranges: LineRange[]) => onChange(ranges.reduce(coverage(value, ranges) === "full" ? removeRange : addRange, value));
  const n = Math.min(30, Math.floor(Number(count)) || 0);
  const state = (ranges: LineRange[]) => coverage(value, ranges);
  const pressed = (c: ReturnType<typeof coverage>) => (c === "part" ? "mixed" : c === "full");

  return (
    <div className="known">
      <div className="juz-grid">
        {ALL_JUZ.map((j) => {
          const c = state(juzRanges(meta, j));
          return (
            <button type="button" key={j} className={`juz-key ${c}`} aria-pressed={pressed(c)} aria-label={`${t("juz")} ${j}`} onClick={() => toggle(juzRanges(meta, j))}>
              {j}
            </button>
          );
        })}
      </div>

      <div className="known-fill">
        <label>
          {t("known_count")}
          <input type="number" inputMode="numeric" min={1} max={30} value={count} onChange={(e) => setCount(e.target.value)} />
        </label>
        <label>
          {t("known_from")}
          <select value={from} onChange={(e) => setFrom(Number(e.target.value) as 1 | -1)}>
            <option value={1}>{t("known_top")}</option>
            <option value={-1}>{t("known_bottom")}</option>
          </select>
        </label>
        <button
          type="button"
          className="ghost"
          disabled={n < 1}
          onClick={() => {
            const list = (from === 1 ? ALL_JUZ : [...ALL_JUZ].reverse()).slice(0, n);
            onChange(list.flatMap((j) => juzRanges(meta, j)).reduce(addRange, value));
          }}
        >
          {t("known_mark")}
        </button>
      </div>

      <details className="more">
        <summary>{t("known_partly")}</summary>
        <label>
          {t("juz")}
          <select value={juz} onChange={(e) => setJuz(Number(e.target.value))}>
            {ALL_JUZ.map((j) => (
              <option key={j} value={j}>
                {j}
              </option>
            ))}
          </select>
        </label>
        <p className="known-label">{t("known_surahs")}</p>
        <div className="known-surahs">
          {juzSurahs(meta, juz).map(({ n: num, ranges }) => {
            const c = state(ranges);
            const pages = ranges.map((r) => r.page);
            return (
              <button type="button" key={num} className={`choice ${c === "full" ? "on" : ""}`} aria-pressed={pressed(c)} onClick={() => toggle(ranges)}>
                <b>
                  {num}. {surahName(surahs[num - 1], lang)}
                </b>
                <span className="muted">
                  {pages.length > 1 ? t("known_pages", { a: pages[0], b: pages[pages.length - 1] }) : `${t("page")} ${pages[0]}`}
                  {c === "part" ? `, ${t("known_some")}` : ""}
                </span>
              </button>
            );
          })}
        </div>
        <p className="known-label">{t("known_byPage")}</p>
        <div className="juz-grid">
          {juzPages(meta, juz).map((p) => {
            const r = [{ page: p, from: 0, to: linesOn(meta, p) }];
            const c = state(r);
            return (
              <button type="button" key={p} className={`juz-key ${c}`} aria-pressed={pressed(c)} aria-label={`${t("page")} ${p}`} onClick={() => toggle(r)}>
                {p}
              </button>
            );
          })}
        </div>
      </details>
    </div>
  );
}

/** Откуда учить: направление, что уже выучено, страница. page null: программа выбирает сама. */
export interface Start {
  dir: 1 | -1;
  known: boolean;
  learned: Learned;
  page: number | null;
}

export const NEW_START: Start = { dir: 1, known: false, learned: new Map(), page: null };

export function startPage(s: Start, meta: MushafMeta): number {
  return s.page ?? firstFree(s.known ? s.learned : new Map(), meta, s.dir) ?? meta.pages;
}

export function StartPicker({ meta, value, onChange }: { meta: MushafMeta; value: Start; onChange: (s: Start) => void }) {
  const t = useT();
  return (
    <div className="form start">
      <label>
        {t("direction")}
        <select value={value.dir} onChange={(e) => onChange({ ...value, dir: Number(e.target.value) as 1 | -1, page: null })}>
          <option value={1}>{t("dir_forward")}</option>
          <option value={-1}>{t("dir_backward")}</option>
        </select>
      </label>
      <div className="choices">
        {[false, true].map((k) => (
          <button type="button" key={String(k)} className={`choice ${value.known === k ? "on" : ""}`} aria-pressed={value.known === k} onClick={() => onChange({ ...value, known: k, page: null })}>
            {t(k ? "known_yes" : "known_no")}
          </button>
        ))}
      </div>
      {value.known && (
        <>
          <p className="muted">{t("known_note")}</p>
          <LearnedPicker meta={meta} value={value.learned} direction={value.dir} onChange={(learned) => onChange({ ...value, learned, page: null })} />
        </>
      )}
      <PageField meta={meta} page={startPage(value, meta)} all={value.known && firstFree(value.learned, meta, value.dir) === null} onChange={(page) => onChange({ ...value, page })} />
    </div>
  );
}

function PageField({ meta, page, all, onChange }: { meta: MushafMeta; page: number; all: boolean; onChange: (p: number) => void }) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  if (all) return <p>{t("known_all")}</p>;
  return (
    <label>
      {t("startPage")}
      <input
        type="number"
        inputMode="numeric"
        min={1}
        max={meta.pages}
        value={text ?? page}
        onChange={(e) => {
          setText(e.target.value);
          const p = Math.floor(Number(e.target.value));
          if (p >= 1 && p <= meta.pages) onChange(p);
        }}
        onBlur={() => setText(null)}
      />
    </label>
  );
}

/** Отметить выученное у ученика, который уже занимается. */
export function LearnedEditor({ student, meta }: { student: Student; meta: MushafMeta }) {
  const t = useT();
  const [draft, setDraft] = useState<{ learned: Learned; page: number | null } | null>(null);
  if (!draft) {
    return (
      <button className="ghost" onClick={() => setDraft({ learned: learnedOf(student.hifz, meta), page: null })}>
        {t("known_edit")}
      </button>
    );
  }
  const busy = !!(student.hifz.lesson || student.hifz.pending);
  const free = firstFree(draft.learned, meta, student.direction);
  return (
    <div className="form">
      <h3>{t("known_edit")}</h3>
      <p className="muted">{t("known_note")}</p>
      <LearnedPicker meta={meta} value={draft.learned} direction={student.direction} onChange={(learned) => setDraft({ ...draft, learned })} />
      {busy ? (
        <p className="muted">{t("known_busy")}</p>
      ) : (
        <>
          <PageField meta={meta} page={draft.page ?? student.hifz.cur.page} all={free === null} onChange={(page) => setDraft({ ...draft, page })} />
          {free !== null && free !== (draft.page ?? student.hifz.cur.page) && (
            <button className="link" onClick={() => setDraft({ ...draft, page: free })}>
              {t("known_first", { p: free })}
            </button>
          )}
        </>
      )}
      <div className="row">
        <button className="ghost" onClick={() => setDraft(null)}>
          {t("cancel")}
        </button>
        <button
          onClick={() => {
            setLearned(student.id, draft.learned, draft.page, meta);
            setDraft(null);
          }}
        >
          {t("save")}
        </button>
      </div>
    </div>
  );
}

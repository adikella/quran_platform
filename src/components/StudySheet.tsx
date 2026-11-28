import { useEffect, useState, type ReactNode } from "react";
import { useT } from "../hooks";
import { Icon } from "../icons";
import { surahName } from "../mushaf";
import { notes, type Note, type Topic } from "../surahapp";
import type { Lang, Surah } from "../types";

const TOPICS: Topic[] = ["fawaed", "mokhtasar", "tajweed", "nozool", "qeraat", "eerab", "saadi", "fadael"];

/** Разметка текстов «Суры»: {аят} цитата, _слово_ пояснение, *заголовок*, ¬сноска¥, @чтецы/как читают. */
export function richText(text: string): ReactNode[] {
  const inline = (s: string, key: string): ReactNode[] =>
    s.split(/(\{[^}]*\}|_[^_\n]+_|\*[^*\n]+\*|¬[^¥]*¥)/g).map((part, i) => {
      const k = `${key}-${i}`;
      if (/^\{.*\}$/.test(part)) return <q key={k} className="quote">{part.slice(1, -1)}</q>;
      if (/^_.*_$/.test(part)) return <em key={k}>{part.slice(1, -1)}</em>;
      if (/^\*.*\*$/.test(part)) return <b key={k}>{part.slice(1, -1)}</b>;
      if (/^¬.*¥$/.test(part)) return <small key={k} className="muted">{part.slice(1, -1)}</small>;
      return part;
    });
  return text
    .replace(/\r/g, "")
    .split(/\n+/)
    .filter((p) => p.trim())
    .flatMap((p, i) => {
      const head = p.match(/^-{3}\{(.+)\}-{3}$/);
      if (head) return [<p key={i} className="study-sub">{head[1]}</p>];
      // Кырааты: «@кто/как читает@кто/как читает».
      if (p.includes("@") && p.includes("/")) {
        return p
          .split("@")
          .filter(Boolean)
          .map((x, j) => {
            const [who, how] = x.split("/");
            return (
              <p key={`${i}-${j}`}>
                {how !== undefined ? <b>{who}: </b> : null}
                {inline(how ?? who, `${i}-${j}`)}
              </p>
            );
          });
      }
      return [<p key={i}>{inline(p, `${i}`)}</p>];
    });
}

/** Тафсир, таджвид, кырааты, иъраб и польза страницы из открытого API приложения «Сура». */
export function StudySheet({
  page,
  verses,
  surahs,
  lang,
  onClose,
}: {
  page: number;
  verses: string[];
  surahs: Surah[];
  lang: Lang;
  onClose: () => void;
}) {
  const t = useT();
  const [topic, setTopic] = useState<Topic>("fawaed");
  const [data, setData] = useState<{ topic: Topic; list: Note[] } | "error" | null>(null);

  useEffect(() => {
    let alive = true;
    setData(null);
    notes(topic, page, verses).then(
      (list) => alive && setData({ topic, list }),
      () => alive && setData("error"),
    );
    return () => {
      alive = false;
    };
  }, [topic, page, verses]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", esc);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const label = (n: Note) =>
    n.aya ? `${surahName(surahs[n.sura - 1], lang)} ${n.aya}${n.to ? `–${n.to}` : ""}${n.word ? `, ${n.word}` : ""}` : surahName(surahs[n.sura - 1], lang);

  return (
    <div className="index-sheet" role="dialog" aria-modal="true" aria-label={t("st_title")}>
      <header className="index-head">
        <h2>
          {t("st_title")}, {t("page").toLowerCase()} {page}
        </h2>
        <button className="ghost small icon-btn" onClick={onClose} aria-label={t("idx_close")}>
          <Icon name="close" size={20} />
        </button>
      </header>
      <div className="study-tabs" role="tablist">
        {TOPICS.map((k) => (
          <button key={k} role="tab" aria-selected={topic === k} className={`chip ${topic === k ? "on" : ""}`} onClick={() => setTopic(k)}>
            {t(`st_${k}`)}
          </button>
        ))}
      </div>
      <div className="index-list study-list">
        <p className="muted study-about">{t(`st_${topic}_about`)}</p>
        {data === null && <p className="muted center">{t("loading")}</p>}
        {data === "error" && <p className="muted center">{t("loadError")}</p>}
        {data && data !== "error" && !data.list.length && <p className="muted center">{t("st_none")}</p>}
        {data &&
          data !== "error" &&
          data.list.map((n, i) => (
            <article key={i} className="study-note">
              {topic !== "fawaed" && <h3>{label(n)}</h3>}
              <div dir="rtl" lang="ar" className="study-text">
                {richText(n.text)}
              </div>
            </article>
          ))}
        <p className="muted study-source">{t("st_source")}</p>
      </div>
    </div>
  );
}

/** Таджвид аятов урока: свёрнут, раскрывается по нажатию, чтобы не подсказывать текст, когда читают наизусть. */
export function LessonTajweed({ page, verses, surahs, lang }: { page: number; verses: string[]; surahs: Surah[]; lang: Lang }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Note[] | "error" | null>(null);
  const key = verses.join(",");
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setList(null);
    notes("tajweed", page, verses).then(
      (l) => alive && setList(l),
      () => alive && setList("error"),
    );
    return () => {
      alive = false;
    };
  }, [open, page, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <details className="card lesson-tajweed" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>{t("st_lessonTajweed")}</summary>
      {list === null && <p className="muted">{t("loading")}</p>}
      {list === "error" && <p className="muted">{t("loadError")}</p>}
      {Array.isArray(list) &&
        list.map((n, i) => (
          <article key={i} className="study-note">
            <h3>
              {surahName(surahs[n.sura - 1], lang)} {n.aya}
              {n.to ? `–${n.to}` : ""}
            </h3>
            <div dir="rtl" lang="ar" className="study-text">
              {richText(n.text)}
            </div>
          </article>
        ))}
      {Array.isArray(list) && <p className="muted study-source">{t("st_source")}</p>}
    </details>
  );
}

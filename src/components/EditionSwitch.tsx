import { useState } from "react";
import { useT } from "../hooks";
import { EDITIONS, pagesToMove, switchEdition } from "../edition";
import { loadMeta, loadPage } from "../mushaf";
import { changeStudent } from "../store";
import type { MushafId, MushafMeta, Student } from "../types";

/** Переход между изданиями мединского мусхафа: выученное и место урока переносятся по словам. */
export function EditionSwitch({ student, meta }: { student: Student; meta: MushafMeta }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const busy = !!student.hifz.lesson || !!student.hifz.pending;

  const go = async (to: MushafId) => {
    setState("busy");
    try {
      const pages = student.stage === "hifz" ? pagesToMove(student, meta) : [];
      const [metaTo, from, next] = await Promise.all([
        loadMeta(to),
        Promise.all(pages.map((p) => loadPage(student.mushaf, p))),
        Promise.all(pages.map((p) => loadPage(to, p))),
      ]);
      changeStudent(student.id, (s) =>
        s.stage === "hifz"
          ? switchEdition(s, to, meta, metaTo, new Map(pages.map((p, i) => [p, from[i]])), new Map(pages.map((p, i) => [p, next[i]])))
          : { ...s, mushaf: to },
      );
      setState("done");
    } catch {
      setState("error");
    }
  };

  return (
    <div className="edition">
      <span className="edition-label">{t("ed_title")}</span>
      <div className="choices" role="radiogroup" aria-label={t("ed_title")}>
        {EDITIONS.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={student.mushaf === m}
            className={`choice ${student.mushaf === m ? "on" : ""}`}
            disabled={student.mushaf !== m && (busy || state === "busy")}
            onClick={() => student.mushaf !== m && go(m)}
          >
            <b>{t(m as "madani" | "madani1441")}</b>
            <span className="muted">{t(`${m as "madani" | "madani1441"}Desc`)}</span>
          </button>
        ))}
      </div>
      <p className="muted">{busy ? t("ed_busy") : state === "done" ? t("ed_done", { name: t(student.mushaf as "madani") }) : state === "error" ? t("loadError") : t("ed_note")}</p>
    </div>
  );
}

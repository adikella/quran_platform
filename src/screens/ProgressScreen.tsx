import { useRef, useState } from "react";
import { useMeta, useSurahs, useT } from "../hooks";
import { pageSurahs, surahName } from "../mushaf";
import { useAppState } from "../store";
import { LearnedEditor } from "../components/LearnedPicker";
import { learnedOf } from "../learned";
import { revision } from "../method";
import type { Student } from "../types";

type Status = "manzil" | "sabki" | "current" | "nazira" | "none";

/** Карта: все страницы выбранного мусхафа по джузам, у каждой свой статус. */
export function ProgressScreen({ student, openPage, edit }: { student: Student; openPage?: (p: number) => void; edit?: boolean }) {
  const t = useT();
  const meta = useMeta(student.mushaf);
  const surahs = useSurahs();
  const { lang } = useAppState();
  const [hint, setHint] = useState<{ p: number; x: number; y: number } | null>(null);
  const hold = useRef<{ timer: number; shown: boolean } | null>(null);
  if (!meta) return <p className="muted pad">{t("loading")}</p>;

  const rev = revision(student, meta);
  const h = student.hifz;
  const full = new Set(h.memorized);
  const learned = learnedOf(h, meta);
  const status = new Map<number, Status>();
  student.nazira.read.forEach((p) => status.set(p, "nazira"));
  rev.manzilQueue.forEach((u) => u.ranges.forEach((r) => status.set(r.page, "manzil")));
  rev.sabki.forEach((r) => status.set(r.page, "sabki"));
  rev.sabkiWaiting.forEach((p) => status.set(p, "sabki"));
  if (student.stage === "hifz" && !full.has(h.cur.page)) status.set(h.cur.page, "current");
  const half = (p: number) => (!full.has(p) && learned.has(p) && status.get(p) !== "current" ? " half" : "");

  const byJuz = new Map<number, number[]>();
  meta.page.forEach(([j], i) => {
    const list = byJuz.get(j) ?? [];
    list.push(i + 1);
    byJuz.set(j, list);
  });

  const show = (p: number, el: Element) => {
    const r = el.getBoundingClientRect();
    setHint({ p, x: r.left + r.width / 2, y: r.top });
  };
  const hintLines = (p: number) =>
    pageSurahs(meta, p, surahs).map(({ surah, from, to }) => {
      const name = surahName(surahs[surah - 1], lang) || `${surah}`;
      return from === to ? `${name} ${from}` : `${name} ${from}–${to}`;
    });

  const legend: Status[] = ["manzil", "sabki", "current", "nazira", "none"];
  return (
    <div className="screen">
      <section className="card">
        <p>{t("pagesMemorized", { n: h.memorized.length })}</p>
        <div className="legend">
          {legend.map((s) => (
            <span key={s}>
              <i className={`cell ${s}`} /> {t(`legend_${s}` as const)}
            </span>
          ))}
        </div>
        {edit && student.stage === "hifz" && <LearnedEditor key={student.id} student={student} meta={meta} />}
      </section>
      <section className="card map">
        {[...byJuz.entries()].map(([j, pages]) => (
          <div key={j} className="juz-row">
            <span className="juz-num">{j}</span>
            <div className="cells">
              {pages.map((p) => (
                <button
                  key={p}
                  className={`cell ${status.get(p) ?? "none"}${half(p)}`}
                  aria-label={`${t("page")} ${p}, ${hintLines(p).join(", ")}`}
                  disabled={!openPage}
                  onPointerEnter={(e) => e.pointerType === "mouse" && show(p, e.currentTarget)}
                  onPointerLeave={(e) => e.pointerType === "mouse" && setHint(null)}
                  onPointerDown={(e) => {
                    if (e.pointerType === "mouse") return;
                    const el = e.currentTarget;
                    // Пальцем: подержать, и покажется, что на странице. Короткое нажатие открывает страницу.
                    const h = { timer: 0, shown: false };
                    h.timer = window.setTimeout(() => {
                      h.shown = true;
                      show(p, el);
                    }, 350);
                    hold.current = h;
                  }}
                  onPointerUp={() => {
                    if (hold.current) clearTimeout(hold.current.timer);
                    if (hold.current?.shown) setTimeout(() => setHint(null), 1500);
                  }}
                  onPointerCancel={() => {
                    if (hold.current) clearTimeout(hold.current.timer);
                    hold.current = null;
                    setHint(null);
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={() => {
                    if (hold.current?.shown) {
                      hold.current = null;
                      return;
                    }
                    hold.current = null;
                    openPage?.(p);
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </section>
      {hint && (
        <div
          className="page-hint"
          role="tooltip"
          style={{ left: Math.min(window.innerWidth - 112, Math.max(112, hint.x)), top: hint.y }}
        >
          <b>
            {t("page")} {hint.p}, {t("juz").toLowerCase()} {meta.page[hint.p - 1][0]}
          </b>
          {hintLines(hint.p).map((l) => (
            <span key={l}>{l}</span>
          ))}
        </div>
      )}
    </div>
  );
}

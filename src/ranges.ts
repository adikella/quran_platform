// Как страницы и строки называются словами.

import type { Key } from "./i18n";
import type { ManzilUnit } from "./method";
import type { LineRange } from "./types";

export type T = (key: Key, vars?: Record<string, string | number>) => string;

export function rangeText(r: LineRange, lineCount: number, t: T) {
  if (r.from === 0 && r.to >= lineCount) return `${t("page")} ${r.page}`;
  return `${t("page")} ${r.page}, ${r.from + 1}–${r.to}`;
}

/** «Стр. 63, 1–4; Стр. 53–62»: подряд идущие целые страницы сворачиваются в диапазон. */
export function rangesText(ranges: LineRange[], lineCount: (p: number) => number, t: T) {
  const parts: string[] = [];
  let run: number[] = [];
  const flush = () => {
    if (!run.length) return;
    const lo = Math.min(...run);
    const hi = Math.max(...run);
    parts.push(lo === hi ? `${t("page")} ${lo}` : `${t("page")} ${lo}–${hi}`);
    run = [];
  };
  for (const r of ranges) {
    const whole = r.from === 0 && r.to >= lineCount(r.page);
    if (whole && (!run.length || Math.abs(run[run.length - 1] - r.page) === 1)) run.push(r.page);
    else {
      flush();
      if (whole) run.push(r.page);
      else parts.push(rangeText(r, lineCount(r.page), t));
    }
  }
  flush();
  return parts.join("; ");
}

/** «Джуз 5, стр. 82–101». */
export function unitText(u: ManzilUnit, t: T) {
  const pages = u.ranges.map((r) => r.page);
  return t("manzilGroup", { j: u.juz, a: Math.min(...pages), b: Math.max(...pages) });
}

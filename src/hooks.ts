import { useCallback, useEffect, useRef, useState } from "react";
import { translate, type Key } from "./i18n";
import { loadMeta, loadPage, loadSurahs } from "./mushaf";
import { useAppState } from "./store";
import type { MushafId, MushafMeta, PageData, Surah } from "./types";

export function useT() {
  const { lang } = useAppState();
  return useCallback((key: Key, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: boolean } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let live = true;
    setError(false);
    setData(null);
    fn().then(
      (d) => live && setData(d),
      () => live && setError(true),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error };
}

export function useMeta(m: MushafId): MushafMeta | null {
  return useAsync(() => loadMeta(m), [m]).data;
}

export function useSurahs(): Surah[] {
  return useAsync(() => loadSurahs(), []).data ?? [];
}

export function usePages(m: MushafId, pages: number[]): { data: PageData[] | null; error: boolean } {
  const key = pages.join(",");
  return useAsync(() => Promise.all(pages.map((p) => loadPage(m, p))), [m, key]);
}

/** Таймер сессии: время с паузой и время каждого повторения (между нажатиями +1). */
export function useSessionTimer() {
  const [running, setRunning] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [laps, setLaps] = useState<number[]>([]);
  const lastLapAt = useRef(0);
  const elapsedRef = useRef(0);

  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now() - elapsedRef.current * 1000;
    const id = setInterval(() => {
      elapsedRef.current = (Date.now() - startedAt) / 1000;
      setElapsed(elapsedRef.current);
    }, 250);
    return () => clearInterval(id);
  }, [running]);

  const lap = useCallback(() => {
    const now = elapsedRef.current;
    setLaps((l) => [...l, now - lastLapAt.current]);
    lastLapAt.current = now;
    setRunning(true);
  }, []);

  const undoLap = useCallback(() => {
    setLaps((l) => {
      if (!l.length) return l;
      lastLapAt.current -= l[l.length - 1];
      return l.slice(0, -1);
    });
  }, []);

  return {
    running,
    elapsed,
    laps,
    toggle: () => setRunning((r) => !r),
    lap,
    undoLap,
    /** Текущее значение без ожидания перерисовки (для сохранения при выходе). */
    read: () => elapsedRef.current,
  };
}

/** Текущее время, обновляется раз в 30 секунд. */
export function useNow(intervalMs = 30000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(ss).padStart(2, "0")}`;
}

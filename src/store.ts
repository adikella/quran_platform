// Состояние приложения. Пока всё хранится на устройстве (localStorage);
// синхронизация через сервер появится вместе с ИИ-проверкой.

import { useSyncExternalStore } from "react";
import { DEFAULT_METHOD, gradeFor, nextLessonRange, stepPage, todayKey } from "./method";
import type {
  AppState,
  DayStats,
  Lang,
  LineRange,
  MushafId,
  Stage,
  Student,
  Submission,
  SubmissionKind,
  Theme,
  TimeCategory,
  Volume,
} from "./types";

const KEY = "quran-platform:v1";

function detectLang(): Lang {
  const tg = (window as any).Telegram?.WebApp?.initDataUnsafe?.user?.language_code as string | undefined;
  const code = (tg || navigator.language || "ru").slice(0, 2).toLowerCase();
  return (["ru", "kk", "en", "ar"] as Lang[]).includes(code as Lang) ? (code as Lang) : "ru";
}

/** Правки методики для учеников, сохранённых раньше. */
function migrate(s: AppState): AppState {
  if ((s.methodRev ?? 0) < 1) {
    // Шаг «наизусть 20 раз» убран: выученное и так повторяется до нормы шагом «повторяй до нормы».
    s.students.forEach((st) => {
      if (st.method.heart === 20) st.method = { ...st.method, heart: 0 };
    });
  }
  return { ...s, methodRev: 1 };
}

function load(): AppState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as AppState;
      if (s.version === 1) {
        // Новые поля методики получают значения по умолчанию.
        s.students.forEach((st) => (st.method = { ...DEFAULT_METHOD, ...st.method }));
        return migrate(s);
      }
    }
  } catch {
    /* пустое или повреждённое хранилище — начинаем заново */
  }
  return { version: 1, methodRev: 1, lang: detectLang(), students: [], activeId: null };
}

let state: AppState = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* хранилище недоступно (приватный режим) — работаем без сохранения */
  }
}

function set(next: AppState) {
  state = next;
  persist();
  listeners.forEach((l) => l());
}

export function useAppState(): AppState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

export function getState() {
  return state;
}

export function activeStudent(s: AppState = state): Student | null {
  return s.students.find((x) => x.id === s.activeId) ?? null;
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function updateStudent(id: string, fn: (s: Student) => Student) {
  set({ ...state, students: state.students.map((s) => (s.id === id ? fn(s) : s)) });
}

function day(s: Student, date = todayKey()): DayStats {
  return s.days[date] ?? { reps: 0, seconds: {}, learned: [] };
}

function withDay(s: Student, fn: (d: DayStats) => DayStats, date = todayKey()): Student {
  return { ...s, days: { ...s.days, [date]: fn(day(s, date)) } };
}

export function getDay(s: Student, date = todayKey()) {
  return day(s, date);
}

// ---------- действия ----------

export function setTheme(theme: Theme) {
  set({ ...state, theme });
}

export function setLang(lang: Lang) {
  set({ ...state, lang });
}

export function setActive(id: string) {
  set({ ...state, activeId: id });
}

export interface NewStudent {
  name: string;
  mushaf: MushafId;
  stage: Stage;
  volume: Volume;
  direction: 1 | -1;
  startPage: number;
}

export function addStudent(n: NewStudent) {
  const st: Student = {
    id: uid(),
    name: n.name.trim() || "—",
    mushaf: n.mushaf,
    stage: n.stage,
    volume: n.volume,
    direction: n.direction,
    method: { ...DEFAULT_METHOD },
    nazira: { next: n.stage === "nazira" ? n.startPage : 1, read: [] },
    hifz: {
      memorized: [],
      cur: { page: n.startPage, line: 0 },
      pending: null,
      lesson: null,
      manzilCursor: 0,
    },
    submissions: [],
    days: {},
  };
  set({ ...state, students: [...state.students, st], activeId: st.id });
}

export function removeStudent(id: string) {
  const students = state.students.filter((s) => s.id !== id);
  set({ ...state, students, activeId: students[0]?.id ?? null });
}

export function patchStudent(id: string, patch: Partial<Pick<Student, "name" | "volume" | "direction" | "method" | "stage">>) {
  updateStudent(id, (s) => ({ ...s, ...patch }));
}

/** Поставить закладку на страницу мусхафа или снять её (null). */
export function setBookmark(id: string, page: number | null) {
  updateStudent(id, (s) => {
    const next = { ...s };
    if (page === null) delete next.bookmark;
    else next.bookmark = page;
    return next;
  });
}

/** Перейти от назиры к заучиванию. Заучивание начинается со страницы `startPage`. */
export function startHifz(id: string, startPage: number, direction: 1 | -1) {
  updateStudent(id, (s) => ({
    ...s,
    stage: "hifz",
    direction,
    hifz: { ...s.hifz, cur: { page: startPage, line: 0 }, lesson: null, pending: null },
  }));
}

/** +1 повторение урока: идёт в счётчик урока и в общий итог дня. */
export function addRep(id: string, delta = 1) {
  updateStudent(id, (s) => {
    const l = s.hifz.lesson;
    const next = l ? { ...s, hifz: { ...s.hifz, lesson: { ...l, reps: Math.max(0, (l.reps ?? 0) + delta) } } } : s;
    return withDay(next, (d) => ({ ...d, reps: Math.max(0, d.reps + delta) }));
  });
}

/** Сколько раз повторён текущий урок; если урок выучен и ждёт сдачи, то сколько было у него. */
export function lessonReps(s: Student): number {
  if (s.hifz.lesson) return s.hifz.lesson.reps ?? 0;
  if (s.hifz.pending) {
    for (const date of Object.keys(s.days).sort().reverse()) {
      const l = [...s.days[date].learned].reverse().find((x) => x.range.page === s.hifz.pending!.page && x.range.from === s.hifz.pending!.from);
      if (l) return l.reps ?? 0;
    }
  }
  return 0;
}

export function addTime(id: string, cat: TimeCategory, seconds: number) {
  if (seconds <= 0) return;
  updateStudent(id, (s) =>
    withDay(s, (d) => ({ ...d, seconds: { ...d.seconds, [cat]: (d.seconds[cat] ?? 0) + Math.round(seconds) } })),
  );
}

// ---------- урок (сабак) ----------

export function beginLesson(id: string, lineCount: number) {
  updateStudent(id, (s) => {
    if (s.hifz.lesson || s.hifz.pending) return s;
    const range = nextLessonRange(s.hifz.cur.page, s.hifz.cur.line, lineCount, s.volume);
    return { ...s, hifz: { ...s.hifz, lesson: { range, step: 0, done: 0 } } };
  });
}

export function setLessonProgress(id: string, step: number, done: number) {
  updateStudent(id, (s) => (s.hifz.lesson ? { ...s, hifz: { ...s.hifz, lesson: { ...s.hifz.lesson, step, done } } } : s));
}

export function abandonLesson(id: string) {
  updateStudent(id, (s) => ({ ...s, hifz: { ...s.hifz, lesson: null } }));
}

/** Урок выучен: он ждёт сдачи устазу. */
export function finishLesson(id: string, fromVerse: string, toVerse: string) {
  updateStudent(id, (s) => {
    const l = s.hifz.lesson;
    if (!l) return s;
    const next = { ...s, hifz: { ...s.hifz, lesson: null, pending: l.range } };
    return withDay(next, (d) => ({ ...d, learned: [...d.learned, { range: l.range, fromVerse, toVerse, reps: l.reps ?? 0 }] }));
  });
}

// ---------- сдача ----------

export interface CheckResult {
  kind: SubmissionKind;
  ranges: LineRange[];
  fromVerse: string;
  toVerse: string;
  errors: number;
  notes: number;
  seconds: number;
  /** Сколько групп (джузов) манзиля сдано. */
  groups?: number;
}

export function submit(id: string, r: CheckResult, pages: number, lineCount: (p: number) => number): Submission {
  let saved!: Submission;
  updateStudent(id, (s) => {
    const { grade, passed } = gradeFor(r.errors + r.notes, s.method.maxErrors);
    const { groups, ...rest } = r;
    saved = { id: uid(), date: todayKey(), grade, passed, ...rest };
    let next: Student = { ...s, submissions: [...s.submissions, saved] };

    if (passed && r.kind === "nazira") {
      const page = r.ranges[0].page;
      const read = next.nazira.read.includes(page) ? next.nazira.read : [...next.nazira.read, page];
      next = { ...next, nazira: { next: Math.min(page + 1, pages), read } };
    }

    if (passed && r.kind === "sabak" && next.hifz.pending) {
      const p = next.hifz.pending;
      const h = { ...next.hifz, pending: null };
      if (p.to >= lineCount(p.page)) {
        h.memorized = h.memorized.includes(p.page) ? h.memorized : [...h.memorized, p.page];
        let np = stepPage(p.page, next.direction, pages);
        while (np !== null && h.memorized.includes(np)) np = stepPage(np, next.direction, pages);
        h.cur = { page: np ?? p.page, line: np === null ? lineCount(p.page) : 0 };
      } else {
        h.cur = { page: p.page, line: p.to };
      }
      next = { ...next, hifz: h };
    }

    if (passed && r.kind === "manzil") {
      next = { ...next, hifz: { ...next.hifz, manzilCursor: next.hifz.manzilCursor + (groups ?? 1) } };
    }
    return withDay(next, (d) => ({ ...d, seconds: { ...d.seconds, [r.kind]: (d.seconds[r.kind] ?? 0) + r.seconds } }));
  });
  return saved;
}

// ---------- резервная копия ----------

export function exportJson(): string {
  return JSON.stringify(state, null, 2);
}

export function importJson(text: string) {
  const s = JSON.parse(text) as AppState;
  if (s.version !== 1 || !Array.isArray(s.students)) throw new Error("bad backup");
  s.students.forEach((st) => (st.method = { ...DEFAULT_METHOD, ...st.method }));
  set(migrate(s));
}

// Состояние приложения на устройстве (localStorage). Обмен с сервером: sync.ts.

import { useSyncExternalStore } from "react";
import { settle } from "./merge";
import { atPage, firstFree, learnedOf, nextLesson, withLearned, type Learned } from "./learned";
import { DEFAULT_METHOD, gradeFor, todayKey } from "./method";
import type {
  AppState,
  DayStats,
  Lang,
  LineRange,
  MushafId,
  MushafMeta,
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
  set({
    ...state,
    students: state.students.map((s) => {
      if (s.id !== id) return s;
      const next = fn(s);
      return next === s ? s : { ...next, updatedAt: Date.now() };
    }),
  });
}

/** Любое изменение состояния (для синхронизации). */
export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Положить ученика с сервера как есть, не помечая изменённым. */
export function adoptStudent(st: Student) {
  const doc: Student = { ...st, method: { ...DEFAULT_METHOD, ...st.method } };
  const known = state.students.some((s) => s.id === doc.id);
  const students = known ? state.students.map((s) => (s.id === doc.id ? doc : s)) : [...state.students, doc];
  set({ ...state, students, activeId: state.activeId ?? doc.id });
}

/** Изменить ученика (решение учителя). */
export function changeStudent(id: string, fn: (s: Student) => Student) {
  updateStudent(id, fn);
}

/** Ученика удалили на сервере, а потом вернули из копии: он становится новым. */
export function renewStudent(id: string) {
  const fresh = uid();
  const students = state.students.map((s) => (s.id === id ? { ...s, id: fresh } : s));
  set({ ...state, students, activeId: state.activeId === id ? fresh : state.activeId });
}

export function setRole(role: "student" | "teacher") {
  set({ ...state, role });
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
  /** Что выучено раньше, до приложения. */
  learned?: Learned;
}

export function addStudent(n: NewStudent, meta: MushafMeta) {
  const st: Student = {
    id: uid(),
    name: n.name.trim() || "—",
    mushaf: n.mushaf,
    stage: n.stage,
    volume: n.volume,
    direction: n.direction,
    method: { ...DEFAULT_METHOD },
    nazira: { next: 1, read: [] },
    hifz: { memorized: [], parts: {}, cur: { page: n.startPage, line: 0 }, pending: null, lesson: null, manzilCursor: 0 },
    submissions: [],
    days: {},
    updatedAt: Date.now(),
  };
  const ready = n.learned ? atPage(withLearned(st, n.learned, meta), n.startPage, meta) : st;
  set({ ...state, students: [...state.students, ready], activeId: st.id });
  return st.id;
}

/** Отметить выученное раньше и место, откуда учить дальше (если урока в работе нет). */
export function setLearned(id: string, learned: Learned, page: number | null, meta: MushafMeta) {
  updateStudent(id, (s) => {
    const next = withLearned(s, learned, meta);
    return page === null || s.hifz.lesson || s.hifz.pending ? next : atPage(next, page, meta);
  });
}

/** Поставить круг давнего так, чтобы следующей шла группа после этой страницы. */
export function setManzilAt(id: string, page: number) {
  updateStudent(id, (s) => ({ ...s, hifz: { ...s.hifz, manzilAt: page } }));
}

export function removeStudent(id: string) {
  const students = state.students.filter((s) => s.id !== id);
  set({ ...state, students, activeId: state.activeId === id ? (students[0]?.id ?? null) : state.activeId });
}

export function patchStudent(id: string, patch: Partial<Pick<Student, "name" | "volume" | "method" | "stage">>) {
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

/** Перейти от назиры к заучиванию. */
export function startHifz(id: string, startPage: number, direction: 1 | -1, meta: MushafMeta, learned?: Learned) {
  updateStudent(id, (s) => {
    const next: Student = { ...s, stage: "hifz", direction, hifz: { ...s.hifz, lesson: null, pending: null } };
    return atPage(learned ? withLearned(next, learned, meta) : next, startPage, meta);
  });
}

/** Сменить направление. Место не меняется, если впереди есть что учить. */
export function setDirection(id: string, direction: 1 | -1, meta: MushafMeta) {
  updateStudent(id, (s) => {
    // Пока строки текущей страницы не записаны отдельно, их место знает только прежнее направление.
    const next = { ...withLearned(s, learnedOf(s.hifz, meta), meta), direction };
    if (s.hifz.lesson || s.hifz.pending || nextLesson(next, meta)) return next;
    const page = firstFree(learnedOf(next.hifz, meta), meta, direction);
    return page === null ? next : atPage(next, page, meta);
  });
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

export function beginLesson(id: string, meta: MushafMeta) {
  updateStudent(id, (s) => {
    const range = nextLesson(s, meta);
    if (!range || s.hifz.lesson || s.hifz.pending) return s;
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
  peeks?: number;
  seconds: number;
  /** Сколько групп (джузов) манзиля сдано. */
  groups?: number;
}

export function submit(id: string, r: CheckResult, meta: MushafMeta): Submission {
  let saved!: Submission;
  updateStudent(id, (s) => {
    const { grade, passed } = gradeFor(r.errors + r.notes, s.method.maxErrors);
    const { groups, ...rest } = r;
    saved = { id: uid(), date: todayKey(), grade, passed, ...rest };
    return settle(s, saved, groups, meta);
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

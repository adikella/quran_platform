// Обмен с сервером: вход, прогресс на всех устройствах, связь ученика с учителем, решения учителя.
//
// Прогресс по-прежнему живёт на устройстве и работает без интернета. Сервер хранит копию:
// изменённые ученики уходят на него через пару секунд, чужие изменения приходят при открытии.

import { useSyncExternalStore } from "react";
import { mergeStudents, settle } from "./merge";
import { loadMeta } from "./mushaf";
import { adoptStudent, changeStudent, getState, removeStudent, renewStudent, setRole, subscribe } from "./store";
import { telegramUserId, telegramInitData } from "./telegram";
import type { LineRange, Student, Submission, SubmissionKind } from "./types";

const KEY = "quran-platform:auth";
const JOIN = "quran-platform:join";

export interface Account {
  id: string;
  name: string;
  role: "student" | "teacher" | null;
  code: string | null;
  telegram: boolean;
}

export interface Link {
  student: string;
  teacher: string;
  status: "pending" | "active";
  consent: boolean;
}

/** Что сдаётся: так сдача выглядит на сервере. */
export interface SubMeta {
  kind: SubmissionKind;
  ranges: LineRange[];
  fromVerse: string;
  toVerse: string;
  date: string;
  peeks?: number;
  seconds?: number;
  groups?: number;
}

export interface VerdictIn {
  marks: Record<string, 1 | 2>;
  grade: number;
  passed: boolean;
  comment: string;
}

export interface RemoteSub extends SubMeta {
  id: string;
  student: string;
  audio: boolean;
  created: number;
  verdict?: VerdictIn & { errors: number; notes: number };
}

export interface TeacherBox {
  code: string | null;
  link: string | null;
  requests: { id: string; name: string; created: number }[];
  students: { data: Student; updated: number; consent: boolean }[];
  inbox: RemoteSub[];
}

interface Auth {
  token: string;
  account: Account;
  /** Кому в Telegram принадлежит вход: на одном телефоне бывает два аккаунта Telegram. */
  tgUser?: number;
  /** Что уже есть на сервере: номер версии и updatedAt отправленной копии. */
  synced: Record<string, { rev: number; stamp: number | undefined }>;
  /** Ученики, удалённые здесь, но ещё не на сервере. */
  deletes: string[];
  links: Link[];
  waiting: RemoteSub[];
}

export interface SyncState {
  account: Account | null;
  /** off: входа нет; offline: сервер недоступен; error: сервер не принял ученика. */
  status: "off" | "busy" | "ok" | "offline" | "error";
  links: Link[];
  waiting: RemoteSub[];
  box: TeacherBox | null;
  boxFailed: boolean;
  /** Код учителя из ссылки или введённый при первом входе. */
  joinCode: string | null;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public detail?: unknown,
  ) {
    super(String(status));
  }
}

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as T | null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* хранилище недоступно: вход продержится до закрытия */
  }
}

function loadAuth(): Auth | null {
  const a = read<Auth>(KEY);
  if (!a?.token) return null;
  const tgUser = telegramUserId();
  // Вошёл другой человек с того же телефона: чужой вход не используем.
  if (tgUser && a.tgUser && a.tgUser !== tgUser) return null;
  return a;
}

function joinFromUrl(): string | null {
  const code = new URLSearchParams(location.search).get("join");
  if (code && /^[A-Za-z0-9]{6}$/.test(code)) {
    write(JOIN, code.toUpperCase());
    const url = new URL(location.href);
    url.searchParams.delete("join");
    history.replaceState(null, "", url);
  }
  return read<string>(JOIN);
}

let auth = loadAuth();
let state: SyncState = {
  account: auth?.account ?? null,
  status: auth ? "busy" : "off",
  links: auth?.links ?? [],
  waiting: auth?.waiting ?? [],
  box: null,
  boxFailed: false,
  joinCode: joinFromUrl(),
};
const listeners = new Set<() => void>();

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function saveAuth() {
  write(KEY, auth);
  set({ account: auth?.account ?? null, links: auth?.links ?? [], waiting: auth?.waiting ?? [] });
}

export function useSync(): SyncState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

async function request(method: string, path: string, body?: unknown): Promise<Response> {
  const token = auth?.token;
  const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
  const form = body instanceof FormData;
  if (body !== undefined && !form) headers["content-type"] = "application/json";
  const res = await fetch(`./api${path}`, { method, headers, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  if (!res.ok) {
    const detail = await res.json().then((j) => j.detail, () => undefined);
    // Вход закончился (аккаунт удалён на другом устройстве). Прогресс на устройстве остаётся.
    if (res.status === 401 && token && auth?.token === token) {
      auth = null;
      saveAuth();
      set({ status: "off", box: null });
    }
    throw new ApiError(res.status, detail);
  }
  return res;
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await request(method, path, body)).json() as Promise<T>;
}

// ---------- вход ----------

function enter(r: { token: string; account: Account }) {
  // Другой аккаунт: что было отправлено в прежний, в этом неизвестно.
  auth = { token: r.token, account: r.account, tgUser: telegramUserId(), synced: {}, deletes: [], links: [], waiting: [] };
  saveAuth();
}

/** Войти: в Telegram сразу, в браузере завести аккаунт с этим именем. */
export async function signIn(name: string) {
  if (auth) return;
  const initData = telegramInitData();
  enter(initData ? await api("POST", "/auth/telegram", { initData }) : await api("POST", "/auth/new", { name: name.trim() || "—" }));
  await run();
}

/** Войти по коду с другого устройства. */
export async function signInByCode(code: string) {
  enter(await api("POST", "/auth/redeem", { code, initData: telegramInitData() }));
  if (state.account?.role === "teacher" && !getState().students.length) setRole("teacher");
  await run();
}

export function loginCode(): Promise<{ code: string; seconds: number }> {
  return api("POST", "/auth/code");
}

export async function signOut() {
  await run();
  await api("POST", "/auth/logout").catch(() => {});
  auth = null;
  saveAuth();
  set({ status: "off", box: null });
}

export async function deleteAccount() {
  await api("DELETE", "/me");
  auth = null;
  saveAuth();
  set({ status: "off", box: null });
}

async function patchMe(patch: { name?: string; role?: "student" | "teacher" }) {
  const account = await api<Account>("PATCH", "/me", patch);
  if (auth) {
    auth = { ...auth, account };
    saveAuth();
  }
}

export const renameMe = (name: string) => patchMe({ name });

export async function becomeTeacher(name: string) {
  await signIn(name);
  await patchMe({ role: "teacher", ...(name.trim() ? { name: name.trim() } : {}) });
  setRole("teacher");
}

// ---------- прогресс ----------

let running: Promise<void> | null = null;
let again = false;

/** Забрать чужие изменения и отправить свои. Одновременно идёт только один обмен. */
export function run(): Promise<void> {
  if (!auth) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await exchange();
    } while (again && auth);
  })().finally(() => (running = null));
  return running;
}

async function exchange() {
  const mine = auth;
  if (!mine) return;
  // Пока шёл запрос, могли выйти или войти в другой аккаунт.
  const gone = () => auth?.token !== mine.token;
  try {
    for (const id of [...mine.deletes]) {
      await api("DELETE", `/students/${id}`).catch((e) => {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      });
      if (gone()) return;
      auth!.deletes = auth!.deletes.filter((x) => x !== id);
      delete auth!.synced[id];
    }
    const r = await api<{
      account: Account;
      students: { id: string; rev: number; data: Student }[];
      deleted: string[];
      links: Link[];
      waiting: RemoteSub[];
      verdicts: RemoteSub[];
    }>("GET", "/sync");
    if (gone()) return;
    const a = auth!;
    a.account = r.account;
    a.links = r.links;
    a.waiting = r.waiting;
    for (const id of r.deleted) {
      if (getState().students.some((s) => s.id === id)) {
        // Не с этого входа: ученика удалили, а потом вернули из сохранённой копии.
        if (a.synced[id]) removeStudent(id);
        else renewStudent(id);
      }
      delete a.synced[id];
    }
    for (const s of r.students) if (!a.deletes.includes(s.id)) receive(a, s.id, s.rev, s.data);
    for (const v of r.verdicts) await applyVerdict(v);
    if (gone()) return;
    saveAuth();
    let bad = false;
    for (const s of getState().students) {
      bad = !(await push(a, s.id)) || bad;
      if (gone()) return;
    }
    saveAuth();
    set({ status: bad ? "error" : "ok" });
  } catch (e) {
    if (gone()) return;
    saveAuth();
    set({ status: e instanceof ApiError && e.status < 500 && e.status !== 429 ? "error" : "offline" });
  }
}

/** Копия ученика с сервера. */
function receive(a: Auth, id: string, rev: number, doc: Student) {
  const local = getState().students.find((s) => s.id === id);
  const known = a.synced[id];
  const clean = !local || (known && local.updatedAt === known.stamp);
  if (clean) {
    if (!local || known!.rev !== rev) adoptStudent(doc);
  } else if (!known || known.rev !== rev) {
    const merged = mergeStudents(local, doc);
    adoptStudent({ ...merged, updatedAt: Date.now() });
  } else return;
  a.synced[id] = { rev, stamp: doc.updatedAt };
}

/** Отправить ученика, если он изменился. false: сервер его не принял. */
async function push(a: Auth, id: string): Promise<boolean> {
  for (let tries = 0; tries < 3; tries++) {
    const s = getState().students.find((x) => x.id === id);
    if (!s || a.deletes.includes(id)) return true;
    const known = a.synced[id];
    if (known && known.stamp === s.updatedAt) return true;
    try {
      const { rev } = await api<{ rev: number }>("PUT", `/students/${id}`, { rev: known?.rev ?? 0, data: s });
      a.synced[id] = { rev, stamp: s.updatedAt };
      return true;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      const d = e.detail as { rev?: number; data?: Student } | undefined;
      if (e.status === 409 && d?.data && d.rev) receive(a, id, d.rev, d.data);
      else if (e.status === 410) return true; // удалён только что, уберём при следующем обмене
      else if (e.status === 403 || e.status === 422 || e.status === 413 || e.status === 409) return false;
      else throw e;
    }
  }
  return false;
}

/** Ученик после решения учителя: запись в дневнике и, если принято, дальше по мусхафу. */
async function withVerdict(st: Student, v: RemoteSub): Promise<(s: Student) => Student> {
  const meta = await loadMeta(st.mushaf);
  const { errors, notes, grade, passed, marks, comment } = v.verdict!;
  const sub: Submission = {
    id: v.id,
    date: v.date,
    kind: v.kind,
    ranges: v.ranges,
    fromVerse: v.fromVerse,
    toVerse: v.toVerse,
    errors,
    notes,
    peeks: v.peeks,
    grade,
    passed,
    seconds: v.seconds ?? 0,
    by: "teacher",
    ...(Object.keys(marks).length ? { marks } : {}),
    ...(comment ? { comment } : {}),
  };
  return (s) => settle(s, sub, v.groups, meta.pages, (p) => meta.page[p - 1][3]);
}

async function applyVerdict(v: RemoteSub) {
  const st = getState().students.find((s) => s.id === v.student);
  if (!st || !v.verdict || st.submissions.some((s) => s.id === v.id)) return;
  changeStudent(v.student, await withVerdict(st, v));
}

/** Удалить ученика здесь и на сервере. */
export function deleteStudent(id: string) {
  removeStudent(id);
  if (auth) {
    if (auth.synced[id]) auth.deletes.push(id);
    saveAuth();
    void run();
  }
}

// ---------- связь с учителем ----------

export function setJoinCode(code: string | null) {
  write(JOIN, code);
  set({ joinCode: code });
}

export function findTeacher(code: string): Promise<{ name: string }> {
  return api("GET", `/teachers/${encodeURIComponent(code.trim())}`);
}

export async function joinTeacher(student: string, code: string, consent: boolean) {
  await run();
  await api("POST", `/students/${student}/join`, { code, consent });
  setJoinCode(null);
  await run();
}

export async function setConsent(student: string, consent: boolean) {
  await api("PATCH", `/students/${student}/join`, { consent });
  await run();
}

export async function leaveTeacher(student: string) {
  await api("DELETE", `/students/${student}/join`);
  await run();
}

export async function sendSubmission(student: string, meta: SubMeta, audio: Blob) {
  const form = new FormData();
  form.append("meta", JSON.stringify(meta));
  form.append("audio", audio, "recitation");
  await api("POST", `/students/${student}/submissions`, form);
  await run();
}

export async function withdrawSubmission(id: string) {
  await api("DELETE", `/submissions/${id}`);
  await run();
}

export async function loadAudio(id: string): Promise<Blob> {
  return (await request("GET", `/submissions/${id}/audio`)).blob();
}

// ---------- кабинет учителя ----------

export async function refreshBox() {
  if (!auth) return;
  try {
    const token = auth.token;
    const box = await api<TeacherBox & { fresh: RemoteSub[] }>("GET", "/teacher");
    for (const v of box.fresh) {
      const pupil = box.students.find((p) => p.data.id === v.student);
      if (pupil) pupil.data = (await withVerdict(pupil.data, v))(pupil.data);
    }
    if (auth?.token === token) set({ box, boxFailed: false });
  } catch {
    set({ boxFailed: true });
  }
}

async function teacherDo(method: string, path: string, body?: unknown) {
  await api(method, `/teacher${path}`, body);
  await refreshBox();
}

export const answerRequest = (id: string, accept: boolean) => teacherDo("POST", `/students/${id}`, { accept });
export const expelStudent = (id: string) => teacherDo("DELETE", `/students/${id}`);
export const sendVerdict = (sub: string, v: VerdictIn) => teacherDo("POST", `/submissions/${sub}`, v);
export const checkInPerson = (student: string, meta: SubMeta, verdict: VerdictIn) =>
  teacherDo("POST", `/students/${student}/check`, { meta, verdict });

// ---------- запуск ----------

export function startSync() {
  void run();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let last = getState().students;
  subscribe(() => {
    if (getState().students === last) return;
    last = getState().students;
    clearTimeout(timer);
    timer = setTimeout(run, 2500);
  });
  const wake = () => document.visibilityState === "visible" && void run();
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("online", wake);
  // Пока приложение открыто, решение учителя приходит само.
  setInterval(() => document.visibilityState === "visible" && (state.waiting.length || state.links.length) && void run(), 60_000);
}

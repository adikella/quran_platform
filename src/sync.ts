// Обмен с сервером: вход, прогресс на всех устройствах, связь ученика с учителем, решения учителя.
//
// Прогресс по-прежнему живёт на устройстве и работает без интернета. Сервер хранит копию:
// изменённые ученики уходят на него через пару секунд, чужие изменения приходят при открытии.

import { useSyncExternalStore } from "react";
import { mergeStudents, settle } from "./merge";
import { revision } from "./method";
import { loadMeta, loadPage, loadSurahs } from "./mushaf";
import { makePlan, partialPages, type Names, type PlanItem } from "./plan";
import { adoptStudent, changeStudent, getState, removeStudent, renewStudent, setRole, subscribe } from "./store";
import { telegramUserId, telegramInitData } from "./telegram";
import type { LineRange, MushafId, MushafMeta, Student, Submission, SubmissionKind } from "./types";

const KEY = "quran-platform:auth";
const JOIN = "quran-platform:join";
const LOGIN = "quran-platform:login";

export interface Account {
  id: string;
  name: string;
  role: "student" | "teacher" | null;
}

export interface Link {
  student: string;
  teacher: string;
  group: string;
  status: "pending" | "active";
  consent: boolean;
  /** Напарник: принимает недавнее и давнее. Записи ему разрешаются отдельно. */
  partner: string | null;
  partnerConsent: boolean;
}

/** У кого я напарник: имя и что сегодня сдаётся. */
export interface Mate {
  student: string;
  /** Какой из моих учеников напарник. */
  mine: string;
  name: string;
  mushaf: MushafId;
  maxErrors: number;
  sabki: PlanItem | null;
  manzil: PlanItem | null;
  done: { sabki?: string; manzil?: string };
  inbox: RemoteSub[];
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
  /** Отправлено напарнику, а не учителю. */
  partner?: boolean;
  verdict?: VerdictIn & { errors: number; notes: number; by?: "teacher" | "partner" };
}

export interface Group {
  id: string;
  name: string;
  link: string;
}

export interface TeacherBox {
  groups: Group[];
  requests: { id: string; name: string; group: string; created: number }[];
  students: { data: Student; group: string; updated: number; consent: boolean; partner: string | null }[];
  inbox: RemoteSub[];
}

/** Вход на сайте, который ждёт подтверждения в боте. */
export interface WebLogin {
  poll: string;
  number: number;
  link: string;
  until: number;
}

interface Auth {
  token: string;
  account: Account;
  /** Кому в Telegram принадлежит вход: на одном телефоне бывает два аккаунта Telegram. */
  tgUser?: number;
  /** Что уже есть на сервере: номер версии и updatedAt отправленной копии. */
  synced: Record<string, { rev: number; stamp: number | undefined; plan?: string }>;
  /** Ученики, удалённые здесь, но ещё не на сервере. */
  deletes: string[];
  links: Link[];
  waiting: RemoteSub[];
  mates?: Mate[];
}

export interface SyncState {
  account: Account | null;
  /** off: входа нет; offline: сервер недоступен; error: сервер не принял ученика. */
  status: "off" | "busy" | "ok" | "offline" | "error";
  links: Link[];
  waiting: RemoteSub[];
  mates: Mate[];
  box: TeacherBox | null;
  boxFailed: boolean;
  /** Ссылка группы, по которой пришли. */
  joinCode: string | null;
  /** Ждём «Да, это я» в боте. */
  login: WebLogin | null;
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
  if (code && /^[A-Za-z0-9]{6,16}$/.test(code)) {
    write(JOIN, code.toUpperCase());
    const url = new URL(location.href);
    url.searchParams.delete("join");
    history.replaceState(null, "", url);
  }
  return read<string>(JOIN);
}

function freshLogin(): WebLogin | null {
  const l = read<WebLogin>(LOGIN);
  return l && l.until > Date.now() ? l : null;
}

let auth = loadAuth();
let state: SyncState = {
  account: auth?.account ?? null,
  status: auth ? "busy" : "off",
  links: auth?.links ?? [],
  waiting: auth?.waiting ?? [],
  mates: auth?.mates ?? [],
  box: null,
  boxFailed: false,
  joinCode: joinFromUrl(),
  login: freshLogin(),
};
const listeners = new Set<() => void>();

function set(patch: Partial<SyncState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function saveAuth() {
  write(KEY, auth);
  set({ account: auth?.account ?? null, links: auth?.links ?? [], waiting: auth?.waiting ?? [], mates: auth?.mates ?? [] });
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

async function entered(r: { token: string; account: Account }) {
  enter(r);
  if (r.account.role === "teacher" && !getState().students.length) setRole("teacher");
  await run();
}

/** Войти внутри Telegram. */
export async function signInTelegram() {
  if (!auth) await entered(await api("POST", "/auth/telegram", { initData: telegramInitData() ?? "" }));
}

/** Начать вход на сайте: бот спросит «Это вы входите?». */
export async function startLogin() {
  const r = await api<{ poll: string; number: number; link: string; seconds: number }>("POST", "/auth/web");
  setLogin({ poll: r.poll, number: r.number, link: r.link, until: Date.now() + r.seconds * 1000 });
}

export function setLogin(login: WebLogin | null) {
  write(LOGIN, login);
  set({ login });
}

/** Один круг ожидания (до 20 секунд). */
export async function waitLogin(l: WebLogin): Promise<"waiting" | "in" | "declined" | "expired"> {
  let r: { token?: string; account?: Account; declined?: boolean };
  try {
    // Телефон мог усыпить страницу вместе с запросом: зависший ответ не ждём.
    const hung = new Promise<never>((_, no) => setTimeout(() => no(new Error("timeout")), 35_000));
    r = await Promise.race([api<typeof r>("POST", "/login/poll", { poll: l.poll }), hung]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 410) return "expired";
    throw e;
  }
  if (r.declined) return "declined";
  if (!r.token || !r.account) return "waiting";
  // Пока ждали, вход могли отменить или начать заново.
  if (state.login?.poll !== l.poll) return "expired";
  setLogin(null);
  await entered({ token: r.token, account: r.account });
  return "in";
}

/** Выйти на всех остальных устройствах. */
export const signOutOthers = () => api("POST", "/auth/logout-others");

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
      partnerOf: Mate[];
    }>("GET", "/sync");
    if (gone()) return;
    const a = auth!;
    a.account = r.account;
    a.links = r.links;
    a.waiting = r.waiting;
    a.mates = r.partnerOf;
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
      await pushPlan(a, s.id);
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
  a.synced[id] = { ...a.synced[id], rev, stamp: doc.updatedAt };
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
      a.synced[id] = { ...a.synced[id], rev, stamp: s.updatedAt };
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

/** Названия сур и страницы, где отрывки начинаются посреди страницы. Без сети напоминание уйдёт со страницами. */
async function names(s: Student, meta: MushafMeta): Promise<Names | undefined> {
  if (s.stage !== "hifz") return undefined;
  try {
    const rev = revision(s, meta);
    const ranges = [...rev.sabki, ...rev.manzilToday.flatMap((u) => u.ranges)];
    const pages = partialPages(ranges, meta);
    const [surahs, data] = await Promise.all([loadSurahs(), Promise.all(pages.map((p) => loadPage(s.mushaf, p)))]);
    return { surahs, pages: new Map(pages.map((p, i) => [p, data[i]])) };
  } catch {
    return undefined;
  }
}

/** Отправить план повторения, если он изменился. Неудача не мешает обмену: план уйдёт в следующий раз. */
async function pushPlan(a: Auth, id: string) {
  const s = getState().students.find((x) => x.id === id);
  const known = a.synced[id];
  if (!s || !known) return;
  try {
    const meta = await loadMeta(s.mushaf);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    const plan = makePlan(s, meta, getState().lang, tz, await names(s, meta));
    const text = JSON.stringify(plan);
    if (known.plan === text) return;
    await api("PUT", `/students/${id}/plan`, plan);
    if (a.synced[id]) a.synced[id].plan = text;
  } catch {
    /* в следующий раз */
  }
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
    by: v.verdict!.by ?? "teacher",
    ...(Object.keys(marks).length ? { marks } : {}),
    ...(comment ? { comment } : {}),
  };
  return (s) => settle(s, sub, v.groups, meta);
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

export interface Invite {
  teacher: string;
  group: string;
  /** Ссылка своей же группы. */
  own: boolean;
}

export function findInvite(code: string): Promise<Invite> {
  return api("GET", `/invites/${encodeURIComponent(code)}`);
}

export async function joinTeacher(student: string, code: string, consent: boolean) {
  await run();
  await api("POST", `/students/${student}/join`, { code, consent });
  setJoinCode(null);
  await run();
}

export async function setConsent(student: string, patch: { consent?: boolean; partnerConsent?: boolean }) {
  await api("PATCH", `/students/${student}/join`, patch);
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
export const moveStudent = (id: string, group: string) => teacherDo("PATCH", `/students/${id}`, { group });
export const setPartner = (id: string, partner: string | null) => teacherDo("PATCH", `/students/${id}`, { partner });
export const expelStudent = (id: string) => teacherDo("DELETE", `/students/${id}`);
export const sendVerdict = (sub: string, v: VerdictIn) => teacherDo("POST", `/submissions/${sub}`, v);
export const checkInPerson = (student: string, meta: SubMeta, verdict: VerdictIn) =>
  teacherDo("POST", `/students/${student}/check`, { meta, verdict });

// ---------- напарник ----------

async function mateDo(path: string, body: unknown) {
  await api("POST", `/partner${path}`, body);
  await run();
}

export const mateVerdict = (sub: string, v: VerdictIn) => mateDo(`/submissions/${sub}`, v);
export const mateInPerson = (student: string, meta: SubMeta, verdict: VerdictIn) => mateDo(`/students/${student}/check`, { meta, verdict });

async function groupDo<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await api<T>(method, `/groups${path}`, body);
  await refreshBox();
  return r;
}

export const createGroup = (name: string) => groupDo<{ id: string }>("POST", "", { name });
export const renameGroup = (id: string, name: string) => groupDo("PATCH", `/${id}`, { name });
export const renewGroupLink = (id: string) => groupDo("POST", `/${id}/link`);
export const deleteGroup = (id: string) => groupDo("DELETE", `/${id}`);

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
  setInterval(() => document.visibilityState === "visible" && (state.waiting.length || state.links.length || state.mates.length) && void run(), 60_000);
}

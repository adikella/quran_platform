"""Аккаунты, прогресс учеников, группы учителей и сдачи. Работает службой quran-api (порт 8091).

Кто чем управляет:
- прогресс ученика (students.data) пишет только аккаунт самого ученика; учитель его читает;
- решение учителя хранится в submissions, приложение ученика забирает его и засчитывает у себя;
- недавнее и давнее принимает напарник, если учитель его назначил: другой ученик той же группы. Он видит
  только имя и что сдаётся (students.plan), без дневника и оценок.

Вход только через Telegram. Внутри Telegram подпись initData проверяется токеном бота.
На сайте: сайт получает ссылку на бота, человек нажимает в боте «Да, это я», и ожидающий сайт входит.
Учитель видит ученика, только если тот открыл ссылку группы, записался и учитель его принял.
Запись голоса принимается только с разрешения (links.consent, для напарника отдельно links.partner_consent) и удаляется через 30 дней после проверки.
"""

import asyncio
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import subprocess
import threading
import time
import urllib.parse
import urllib.request
import zoneinfo
from contextlib import contextmanager
from datetime import datetime
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

DATA = os.environ.get("API_DATA", "/var/lib/quran-api")
AUDIO = os.path.join(DATA, "audio")
DB = os.path.join(DATA, "quran.db")
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
APP_URL = os.environ.get("APP_URL", "https://130-61-147-45.sslip.io")

MAX_DOC = 1_000_000
MAX_AUDIO = 40 * 1024 * 1024
MAX_AUDIO_TOTAL = 20 * 1024**3
LOGIN_SECONDS = 600
POLL_SECONDS = 20
KEEP_CHECKED = 30 * 86400
KEEP_WAITING = 60 * 86400
PAGES = {"madani": 604, "madani1441": 604, "indopak": 610}
# Без похожих символов: 0 и O, 1, I и L.
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
AUDIO_TYPES = {"video/webm", "audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg", "audio/wav", "audio/aac"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, tg_id INTEGER UNIQUE, name TEXT NOT NULL, role TEXT, teacher_code TEXT UNIQUE, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS logins (
  poll TEXT PRIMARY KEY, start TEXT NOT NULL UNIQUE, number INTEGER NOT NULL, status TEXT NOT NULL,
  account TEXT REFERENCES accounts(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY, teacher TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, created INTEGER NOT NULL);
DROP TABLE IF EXISTS login_codes;
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  data TEXT, rev INTEGER NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS links (
  student TEXT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  teacher TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL, consent INTEGER, created INTEGER NOT NULL, grp TEXT REFERENCES groups(id));
CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY, student TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  teacher TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, meta TEXT NOT NULL, audio TEXT, mime TEXT, status TEXT NOT NULL,
  verdict TEXT, created INTEGER NOT NULL, checked INTEGER);
CREATE INDEX IF NOT EXISTS students_account ON students(account);
CREATE INDEX IF NOT EXISTS links_teacher ON links(teacher);
CREATE INDEX IF NOT EXISTS submissions_student ON submissions(student);
CREATE INDEX IF NOT EXISTS submissions_teacher ON submissions(teacher, status);
"""

os.makedirs(AUDIO, mode=0o700, exist_ok=True)


@contextmanager
def db():
    """Соединение с записью: всё внутри одна транзакция."""
    c = sqlite3.connect(DB, timeout=15, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    try:
        c.execute("BEGIN IMMEDIATE")
        yield c
        c.execute("COMMIT")
    except BaseException:
        if c.in_transaction:
            c.execute("ROLLBACK")
        raise
    finally:
        c.close()


with sqlite3.connect(DB) as _c:
    _c.execute("PRAGMA journal_mode=WAL")
    _c.executescript(SCHEMA)
    # Раньше у учителя был один код и одна группа: код остаётся ссылкой этой группы.
    if "grp" not in {r[1] for r in _c.execute("PRAGMA table_info(links)")}:
        _c.execute("ALTER TABLE links ADD COLUMN grp TEXT REFERENCES groups(id)")
    for _a, _code in _c.execute("SELECT id, teacher_code FROM accounts WHERE teacher_code IS NOT NULL").fetchall():
        _g = secrets.token_urlsafe(9)
        _c.execute("INSERT INTO groups VALUES (?,?,?,?,?)", (_g, _a, "Моя группа", _code, int(time.time())))
        _c.execute("UPDATE links SET grp=? WHERE teacher=? AND grp IS NULL", (_g, _a))
        _c.execute("UPDATE accounts SET teacher_code=NULL WHERE id=?", (_a,))
    # Напарник (другой ученик того же учителя), план повторения и напоминания.
    for _t, _col in [
        ("links", "partner TEXT REFERENCES students(id) ON DELETE SET NULL"),
        ("links", "partner_consent INTEGER"),
        ("submissions", "partner TEXT REFERENCES students(id) ON DELETE SET NULL"),
        ("students", "plan TEXT"),
        ("students", "reminded TEXT"),
        ("accounts", "muted INTEGER NOT NULL DEFAULT 0"),
    ]:
        if _col.split()[0] not in {r[1] for r in _c.execute(f"PRAGMA table_info({_t})")}:
            _c.execute(f"ALTER TABLE {_t} ADD COLUMN {_col}")
    _c.execute("CREATE INDEX IF NOT EXISTS links_partner ON links(partner)")
os.chmod(DB, 0o600)

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def now() -> int:
    return int(time.time())


def sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def code(n: int) -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(n))


def clean_code(s: str) -> str:
    return re.sub(r"[^A-Z0-9]", "", s.upper())[:16]


# ---------- что принимаем ----------

Id = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{6,64}$")]
Name = Annotated[str, Field(min_length=1, max_length=80)]
Kind = Literal["nazira", "sabak", "sabki", "manzil"]
Verse = Annotated[str, Field(pattern=r"^\d{1,3}:\d{1,3}$")]
Date = Annotated[str, Field(pattern=r"^\d{4}-\d\d-\d\d$")]
Count = Annotated[int, Field(ge=0, le=1_000_000)]


# В документе ученика имя и аяты могут быть пустыми (например, имя стёрли, чтобы набрать заново).
DocName = Annotated[str, Field(max_length=80)]
DocVerse = Annotated[str, Field(pattern=r"^(\d{1,3}:\d{1,3})?$")]
Number = Annotated[float, Field(ge=0, le=1_000_000)]


class Loose(BaseModel):
    model_config = ConfigDict(extra="allow")


class Range(BaseModel):
    page: int = Field(ge=1, le=610)
    from_: int = Field(alias="from", ge=0, le=20)
    to: int = Field(ge=1, le=20)


class Lesson(Loose):
    range: Range
    step: Count
    done: Count


class Cur(BaseModel):
    page: int = Field(ge=1, le=610)
    line: int = Field(ge=0, le=20)


PageKey = Annotated[str, Field(pattern=r"^[1-9]\d{0,2}$")]
Line = Annotated[int, Field(ge=0, le=20)]
Span = tuple[Line, Line]


class Hifz(Loose):
    memorized: list[Annotated[int, Field(ge=1, le=610)]] = Field(max_length=700)
    parts: dict[PageKey, list[Span]] = Field(default={}, max_length=610)
    manzilAt: Annotated[int, Field(ge=1, le=610)] | None = None
    cur: Cur
    pending: Range | None
    lesson: Lesson | None
    manzilCursor: Count


class Nazira(Loose):
    next: int = Field(ge=1, le=610)
    read: list[Annotated[int, Field(ge=1, le=610)]] = Field(max_length=700)


class Learned(Loose):
    range: Range
    fromVerse: DocVerse
    toVerse: DocVerse


class Day(Loose):
    reps: Count
    seconds: dict[Kind, Annotated[float, Field(ge=0)]]
    learned: list[Learned]


class Sub(Loose):
    id: Id
    date: Date
    kind: Kind
    ranges: list[Range] = Field(min_length=1, max_length=700)
    fromVerse: DocVerse
    toVerse: DocVerse
    errors: Count
    notes: Count
    grade: Annotated[int, Field(ge=0, le=10)]
    passed: bool


class MethodDoc(Loose):
    maxErrors: Number
    sabkiPages: Number
    manzilJuz: Number
    dailyTarget: Number
    morningStart: str = Field(max_length=5)
    morningEnd: str = Field(max_length=5)


class StudentDoc(Loose):
    id: Id
    name: DocName
    mushaf: Literal["madani", "madani1441", "indopak"]
    stage: Literal["nazira", "hifz"]
    volume: Literal["lines2", "half", "page"]
    direction: Literal[1, -1]
    method: MethodDoc
    nazira: Nazira
    hifz: Hifz
    submissions: list[Sub]
    days: dict[Date, Day]

    @model_validator(mode="after")
    def pages_exist(self):
        last = PAGES[self.mushaf]
        h = self.hifz
        ranges = [r for s in self.submissions for r in s.ranges]
        ranges += [x for x in (h.pending, h.lesson.range if h.lesson else None) if x]
        pages = [*h.memorized, *map(int, h.parts), h.manzilAt or 1, h.cur.page, self.nazira.next, *self.nazira.read, *(r.page for r in ranges)]
        if any(p > last for p in pages):
            raise ValueError("no such page")
        return self


class Meta(BaseModel):
    """Что сдаётся."""

    kind: Kind
    ranges: list[Range] = Field(min_length=1, max_length=200)
    fromVerse: Verse
    toVerse: Verse
    date: Date
    peeks: Count = 0
    seconds: Count = 0
    groups: Annotated[int, Field(ge=1, le=30)] | None = None

    def dump(self) -> str:
        return self.model_dump_json(by_alias=True, exclude_none=True)


REVISION = ("sabki", "manzil")


class PlanItem(BaseModel):
    text: str = Field(max_length=400)
    ranges: list[Range] = Field(min_length=1, max_length=200)
    groups: Annotated[int, Field(ge=1, le=30)] | None = None


class Plan(BaseModel):
    """Что повторять сегодня. Считает приложение ученика: сервер по этому напоминает, а напарник видит, что принять."""

    head: str = Field(max_length=200)
    sabki: PlanItem | None
    manzil: PlanItem | None
    done: dict[Literal["sabki", "manzil"], Date]
    at: str = Field(pattern=r"^([01]\d:[0-5]\d|2[0-3]:[0-5]\d)?$")
    tz: str = Field(max_length=64)


class Verdict(BaseModel):
    marks: dict[Annotated[str, Field(pattern=r"^\d{1,3}:\d{1,2}:\d{1,2}$")], Literal[1, 2]] = Field(max_length=3000)
    grade: Annotated[int, Field(ge=0, le=10)]
    passed: bool
    comment: str = Field(default="", max_length=500)

    def dump(self, by: str = "teacher") -> str:
        v = self.model_dump()
        v["by"] = by
        v["errors"] = sum(1 for m in self.marks.values() if m == 1)
        v["notes"] = sum(1 for m in self.marks.values() if m == 2)
        return json.dumps(v, ensure_ascii=False)


# ---------- Telegram ----------


def telegram_user(init_data: str) -> dict:
    """Проверяет подпись initData и возвращает пользователя Telegram."""
    if not BOT_TOKEN:
        raise HTTPException(503, "telegram off")
    try:
        pairs = dict(urllib.parse.parse_qsl(init_data, keep_blank_values=True, strict_parsing=True))
    except ValueError:
        raise HTTPException(401, "bad init data")
    given = pairs.pop("hash", "")
    check = "\n".join(f"{k}={v}" for k, v in sorted(pairs.items()))
    key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    want = hmac.new(key, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(want.encode(), given.encode()):
        raise HTTPException(401, "bad signature")
    try:
        if now() - int(pairs["auth_date"]) > 86400:
            raise HTTPException(401, "stale")
        user = json.loads(pairs["user"])
        return {"id": int(user["id"]), "name": str(user.get("first_name") or "")[:80]}
    except (KeyError, ValueError, TypeError):
        raise HTTPException(401, "bad user")


def bot_call(method: str, body: dict | None = None) -> dict | None:
    if not BOT_TOKEN:
        return None
    req = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/{method}",
        data=json.dumps(body or {}).encode(), headers={"content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.load(r).get("result")
    except Exception as e:  # noqa: BLE001  адрес содержит токен, поэтому в журнал идёт только вид ошибки
        print(f"telegram {method}: {type(e).__name__}", flush=True)
        return None


_bot_name: str | None = os.environ.get("BOT_NAME")


def bot_name() -> str | None:
    global _bot_name
    if _bot_name is None:
        _bot_name = (bot_call("getMe") or {}).get("username")
    return _bot_name


def notify(tg_id: int | None, text: str):
    """Сообщение от бота. Имён в нём нет. Не дошло: не страшно, всё видно в приложении."""
    if not tg_id or not BOT_TOKEN:
        return
    body = {
        "chat_id": tg_id, "text": text,
        "reply_markup": {"inline_keyboard": [[{"text": "Открыть", "web_app": {"url": APP_URL}}]]},
    }
    threading.Thread(target=bot_call, args=("sendMessage", body), daemon=True).start()


# ---------- вход ----------


def account_by_token(c: sqlite3.Connection, authorization: str | None) -> sqlite3.Row | None:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return c.execute(
        "SELECT a.* FROM tokens t JOIN accounts a ON a.id=t.account WHERE t.hash=?", (sha(authorization[7:]),)
    ).fetchone()


def current(authorization: Annotated[str | None, Header()] = None) -> sqlite3.Row:
    with db() as c:
        acc = account_by_token(c, authorization)
    if not acc:
        raise HTTPException(401, "sign in")
    return acc


Me = Annotated[sqlite3.Row, Depends(current)]


def new_token(c: sqlite3.Connection, account: str) -> str:
    token = secrets.token_urlsafe(32)
    c.execute("INSERT INTO tokens VALUES (?,?,?)", (sha(token), account, now()))
    return token


def new_account(c: sqlite3.Connection, name: str, tg_id: int | None) -> str:
    aid = secrets.token_urlsafe(12)
    c.execute("INSERT INTO accounts (id,tg_id,name,created) VALUES (?,?,?,?)", (aid, tg_id, name or "—", now()))
    return aid


def account_json(a: sqlite3.Row) -> dict:
    return {"id": a["id"], "name": a["name"], "role": a["role"]}


def signed_in(c: sqlite3.Connection, aid: str) -> dict:
    a = c.execute("SELECT * FROM accounts WHERE id=?", (aid,)).fetchone()
    return {"token": new_token(c, aid), "account": account_json(a)}


class TgIn(BaseModel):
    initData: str = Field(max_length=8000)


class NameIn(BaseModel):
    name: Name


def telegram_account(c: sqlite3.Connection, tg_id: int, name: str) -> str:
    a = c.execute("SELECT id FROM accounts WHERE tg_id=?", (tg_id,)).fetchone()
    return a["id"] if a else new_account(c, name, tg_id)


@app.post("/api/auth/telegram")
def auth_telegram(body: TgIn):
    """Вход внутри Telegram."""
    u = telegram_user(body.initData)
    with db() as c:
        return signed_in(c, telegram_account(c, u["id"], u["name"]))


# Вход на сайте. Сайт знает секрет poll и ждёт по нему; бот знает только start из ссылки.
# Число видно и на сайте, и в боте: по нему понятно, что подтверждаешь именно свой вход.


@app.post("/api/auth/web")
def auth_web():
    bot = bot_name()
    if not bot:
        raise HTTPException(503, "telegram off")
    poll, start, number = secrets.token_urlsafe(32), secrets.token_urlsafe(18), secrets.randbelow(90) + 10
    with db() as c:
        c.execute("DELETE FROM logins WHERE expires<?", (now(),))
        c.execute("INSERT INTO logins VALUES (?,?,?,'new',NULL,?)", (sha(poll), start, number, now() + LOGIN_SECONDS))
    return {"poll": poll, "number": number, "seconds": LOGIN_SECONDS, "link": f"https://t.me/{bot}?start=login_{start}"}


class PollIn(BaseModel):
    poll: str = Field(max_length=100)


def take_login(poll: str) -> dict | None:
    """Вход, если его подтвердили; None, если ещё ждём.

    Ответ выдаётся, пока вход не устарел, а не один раз: пока человек в Telegram, телефон обрывает
    запрос сайта, и одноразовый ответ ушёл бы в никуда. Секрет poll знает только этот сайт.
    """
    with db() as c:
        r = c.execute("SELECT * FROM logins WHERE poll=?", (sha(poll),)).fetchone()
        if not r or r["expires"] < now():
            raise HTTPException(410, "expired")
        if r["status"] == "new":
            return None
        return signed_in(c, r["account"]) if r["status"] == "yes" else {"declined": True}


@app.post("/api/login/poll")
async def poll_login(body: PollIn):
    for _ in range(POLL_SECONDS):
        done = await asyncio.to_thread(take_login, body.poll)
        if done:
            return done
        await asyncio.sleep(1)
    return {"waiting": True}


# Для бота на этом же сервере. Наружу nginx отдаёт только /api/, но секрет проверяется всё равно.


def bot_secret() -> str:
    return hmac.new(BOT_TOKEN.encode(), b"quran-internal", hashlib.sha256).hexdigest()


def from_bot(x_bot: Annotated[str, Header()] = ""):
    if not BOT_TOKEN or not hmac.compare_digest(x_bot.encode(), bot_secret().encode()):
        raise HTTPException(403, "no")


class BotLogin(BaseModel):
    start: str = Field(max_length=64)
    tg_id: int | None = None
    name: str = Field(default="", max_length=200)
    yes: bool = False


@app.post("/internal/login", dependencies=[Depends(from_bot)])
def bot_look(body: BotLogin):
    with db() as c:
        r = c.execute("SELECT number FROM logins WHERE start=? AND status='new' AND expires>=?", (body.start, now())).fetchone()
    if not r:
        raise HTTPException(404, "expired")
    return {"number": r["number"]}


@app.post("/internal/login/answer", dependencies=[Depends(from_bot)])
def bot_answer(body: BotLogin):
    with db() as c:
        r = c.execute("SELECT poll FROM logins WHERE start=? AND status='new' AND expires>=?", (body.start, now())).fetchone()
        if not r or (body.yes and not body.tg_id):
            raise HTTPException(404, "expired")
        account = telegram_account(c, body.tg_id, body.name[:80]) if body.yes else None
        c.execute("UPDATE logins SET status=?, account=? WHERE poll=?", ("yes" if body.yes else "no", account, r["poll"]))
    return {"ok": True}


@app.post("/api/auth/logout")
def logout(me: Me, authorization: Annotated[str | None, Header()] = None):
    with db() as c:
        c.execute("DELETE FROM tokens WHERE hash=?", (sha(authorization[7:]),))
    return {"ok": True}


@app.post("/api/auth/logout-others")
def logout_others(me: Me, authorization: Annotated[str | None, Header()] = None):
    """Выйти везде, кроме этого устройства."""
    with db() as c:
        c.execute("DELETE FROM tokens WHERE account=? AND hash<>?", (me["id"], sha(authorization[7:])))
    return {"ok": True}


class MePatch(BaseModel):
    name: Name | None = None
    role: Literal["student", "teacher"] | None = None


@app.patch("/api/me")
def patch_me(body: MePatch, me: Me):
    with db() as c:
        if body.name:
            c.execute("UPDATE accounts SET name=? WHERE id=?", (body.name.strip() or me["name"], me["id"]))
        if body.role:
            c.execute("UPDATE accounts SET role=? WHERE id=?", (body.role, me["id"]))
        if body.role == "teacher" and not c.execute("SELECT 1 FROM groups WHERE teacher=?", (me["id"],)).fetchone():
            new_group(c, me["id"], "Моя группа")
        return account_json(c.execute("SELECT * FROM accounts WHERE id=?", (me["id"],)).fetchone())


@app.delete("/api/me")
def delete_me(me: Me):
    """Удалить аккаунт, учеников и записи."""
    with db() as c:
        files = audio_names(
            c, "student IN (SELECT id FROM students WHERE account=?) OR teacher=?", (me["id"], me["id"])
        )
        c.execute("DELETE FROM accounts WHERE id=?", (me["id"],))
    remove_files(files)
    return {"ok": True}


# ---------- записи голоса ----------


def audio_names(c: sqlite3.Connection, where: str, args: tuple) -> list[str]:
    return [r["audio"] for r in c.execute(f"SELECT audio FROM submissions WHERE audio IS NOT NULL AND ({where})", args)]


def transcode(src: str, dst: str):
    """Любая запись в m4a: играет на всех телефонах, и её можно перематывать."""
    p = subprocess.run(
        ["ffmpeg", "-nostdin", "-loglevel", "error", "-protocol_whitelist", "file", "-i", src, "-t", "7200", "-map", "0:a:0",
         "-vn", "-map_metadata", "-1", "-ac", "1", "-c:a", "aac", "-b:a", "48k", "-movflags", "+faststart", "-f", "mp4", dst],
        capture_output=True, timeout=280,
    )
    if p.returncode != 0 or os.path.getsize(dst) == 0:
        raise HTTPException(400, "bad audio")


def remove_files(names: list[str]):
    for n in names:
        try:
            os.remove(os.path.join(AUDIO, n))
        except FileNotFoundError:
            pass


def drop_waiting(c: sqlite3.Connection, where: str, args: tuple) -> list[str]:
    """Убирает непроверенные сдачи. Файлы удалить после записи в базу."""
    where = f"status='waiting' AND ({where})"
    files = audio_names(c, where, args)
    c.execute(f"DELETE FROM submissions WHERE {where}", args)
    return files


def drop_audio(c: sqlite3.Connection, where: str, args: tuple) -> list[str]:
    files = audio_names(c, where, args)
    c.execute(f"UPDATE submissions SET audio=NULL WHERE {where}", args)
    return files


def purge():
    t = now()
    with db() as c:
        files = drop_audio(c, "status='checked' AND checked<?", (t - KEEP_CHECKED,))
        files += drop_waiting(c, "created<?", (t - KEEP_WAITING,))
        c.execute("DELETE FROM logins WHERE expires<?", (t,))
        known = {r["audio"] for r in c.execute("SELECT audio FROM submissions WHERE audio IS NOT NULL")}
    remove_files(files)
    # Файлы без строки в базе (сервис упал посреди загрузки).
    for n in os.listdir(AUDIO):
        path = os.path.join(AUDIO, n)
        if n not in known and t - os.path.getmtime(path) > 3600:
            os.remove(path)


def purge_daily():
    while True:
        try:
            purge()
        except Exception as e:  # noqa: BLE001
            print(f"purge: {type(e).__name__}: {e}", flush=True)
        time.sleep(86400)


threading.Thread(target=purge_daily, daemon=True).start()


# ---------- прогресс ученика ----------


def my_student(c: sqlite3.Connection, me: sqlite3.Row, sid: str) -> sqlite3.Row:
    s = c.execute("SELECT * FROM students WHERE id=? AND account=? AND deleted=0", (sid, me["id"])).fetchone()
    if not s:
        raise HTTPException(404, "no student")
    return s


@app.get("/api/sync")
def sync(me: Me):
    with db() as c:
        rows = c.execute("SELECT * FROM students WHERE account=?", (me["id"],)).fetchall()
        links = c.execute(
            "SELECT l.*, a.name, g.name AS grp_name, p.data AS partner_data FROM links l JOIN students s ON s.id=l.student"
            " JOIN accounts a ON a.id=l.teacher JOIN groups g ON g.id=l.grp"
            " LEFT JOIN students p ON p.id=l.partner WHERE s.account=?",
            (me["id"],),
        ).fetchall()
        subs = c.execute(
            "SELECT b.* FROM submissions b JOIN students s ON s.id=b.student"
            " WHERE s.account=? AND (b.status='waiting' OR b.checked>?) ORDER BY b.created DESC LIMIT 500",
            (me["id"], now() - 120 * 86400),
        ).fetchall()
        a = c.execute("SELECT * FROM accounts WHERE id=?", (me["id"],)).fetchone()
        mates = partner_pupils(c, me)
    return {
        "account": account_json(a),
        "partnerOf": mates,
        "students": [{"id": r["id"], "rev": r["rev"], "data": json.loads(r["data"])} for r in rows if not r["deleted"]],
        "deleted": [r["id"] for r in rows if r["deleted"]],
        "links": [
            {"student": r["student"], "teacher": r["name"], "group": r["grp_name"], "status": r["status"], "consent": r["consent"] is not None,
             "partner": json.loads(r["partner_data"])["name"] if r["partner_data"] else None,
             "partnerConsent": r["partner_consent"] is not None}
            for r in links
        ],
        "waiting": [sub_json(r) for r in subs if r["status"] == "waiting"],
        "verdicts": [sub_json(r) for r in reversed(subs) if r["status"] == "checked"],
    }


def sub_json(r: sqlite3.Row) -> dict:
    out = {
        "id": r["id"], "student": r["student"], **json.loads(r["meta"]),
        "audio": r["audio"] is not None, "created": r["created"], "partner": r["partner"] is not None,
    }
    if r["verdict"]:
        out["verdict"] = json.loads(r["verdict"])
    return out


class StudentPut(BaseModel):
    rev: Annotated[int, Field(ge=0)]
    data: dict


@app.put("/api/students/{sid}")
def put_student(sid: Id, body: StudentPut, me: Me):
    raw = json.dumps(body.data, ensure_ascii=False)
    if len(raw.encode()) > MAX_DOC:
        raise HTTPException(413, "too large")
    try:
        doc = StudentDoc.model_validate(body.data)
    except ValidationError as e:
        # Без значений: в них данные ученика.
        raise HTTPException(422, [{"at": x["loc"], "type": x["type"]} for x in e.errors()[:5]])
    if doc.id != sid:
        raise HTTPException(422, "id mismatch")
    with db() as c:
        s = c.execute("SELECT * FROM students WHERE id=?", (sid,)).fetchone()
        if not s:
            if c.execute("SELECT COUNT(*) FROM students WHERE account=? AND deleted=0", (me["id"],)).fetchone()[0] >= 50:
                raise HTTPException(409, "too many students")
            c.execute("INSERT INTO students (id,account,data,rev,updated) VALUES (?,?,?,1,?)", (sid, me["id"], raw, now()))
            return {"rev": 1}
        if s["account"] != me["id"]:
            raise HTTPException(403, "other account")
        if s["deleted"]:
            raise HTTPException(410, "deleted")
        if s["rev"] != body.rev:
            raise HTTPException(409, {"rev": s["rev"], "data": json.loads(s["data"])})
        c.execute("UPDATE students SET data=?, rev=rev+1, updated=? WHERE id=?", (raw, now(), sid))
        return {"rev": s["rev"] + 1}


@app.put("/api/students/{sid}/plan")
def put_plan(sid: Id, body: Plan, me: Me):
    if body.tz not in ZONES:
        body.tz = DEFAULT_TZ
    with db() as c:
        s = my_student(c, me, sid)
        for item in (body.sabki, body.manzil):
            if item:
                check_pages(s, item)
        c.execute("UPDATE students SET plan=? WHERE id=?", (body.model_dump_json(by_alias=True, exclude_none=True), sid))
    return {"ok": True}


@app.delete("/api/students/{sid}")
def delete_student(sid: Id, me: Me):
    with db() as c:
        my_student(c, me, sid)
        files = audio_names(c, "student=?", (sid,))
        c.execute("DELETE FROM submissions WHERE student=?", (sid,))
        unlink(c, sid)
        # Пустая метка остаётся, чтобы удаление дошло до других устройств.
        c.execute("UPDATE students SET data=NULL, plan=NULL, deleted=1, updated=? WHERE id=?", (now(), sid))
    remove_files(files)
    return {"ok": True}


# ---------- связь с учителем ----------


class JoinIn(BaseModel):
    code: str = Field(max_length=32)
    consent: bool


class ConsentIn(BaseModel):
    consent: bool | None = None
    partnerConsent: bool | None = None


GROUP_BY_CODE = "SELECT g.*, a.name AS teacher_name, a.tg_id FROM groups g JOIN accounts a ON a.id=g.teacher WHERE g.code=?"


@app.get("/api/invites/{value}")
def invite(value: str, me: Me):
    """Куда ведёт ссылка: учитель и группа."""
    with db() as c:
        g = c.execute(GROUP_BY_CODE, (clean_code(value),)).fetchone()
    if not g:
        raise HTTPException(404, "no group")
    return {"teacher": g["teacher_name"], "group": g["name"], "own": g["teacher"] == me["id"]}


@app.post("/api/students/{sid}/join")
def join(sid: Id, body: JoinIn, me: Me):
    with db() as c:
        my_student(c, me, sid)
        g = c.execute(GROUP_BY_CODE, (clean_code(body.code),)).fetchone()
        if not g:
            raise HTTPException(404, "no group")
        old = c.execute("SELECT * FROM links WHERE student=?", (sid,)).fetchone()
        consent = now() if body.consent else None
        files = []
        if old and old["teacher"] == g["teacher"]:
            # Тот же учитель, другая группа: подтверждать второй раз незачем.
            if old["grp"] != g["id"]:
                drop_partner(c, sid)
            c.execute("UPDATE links SET grp=?, consent=? WHERE student=?", (g["id"], consent, sid))
            if not body.consent:
                c.execute("UPDATE links SET partner_consent=NULL WHERE student=?", (sid,))
            if not body.consent:
                files = drop_waiting(c, "student=?", (sid,)) + drop_audio(c, "student=?", (sid,))
        else:
            if old:
                files = unlink(c, sid)
            c.execute(
                "INSERT INTO links (student,teacher,status,consent,created,grp) VALUES (?,?,'pending',?,?,?)",
                (sid, g["teacher"], consent, now(), g["id"]),
            )
            notify(g["tg_id"], "Новый ученик просится в группу. Откройте кабинет учителя.")
    remove_files(files)
    return {"ok": True}


def drop_partner(c: sqlite3.Connection, sid: str):
    """Ученик больше никому не напарник, и у него напарника нет. Непроверенное уходит учителю."""
    c.execute("UPDATE submissions SET partner=NULL WHERE status='waiting' AND (partner=? OR student=?)", (sid, sid))
    c.execute("UPDATE links SET partner=NULL, partner_consent=NULL WHERE partner=? OR student=?", (sid, sid))


def unlink(c: sqlite3.Connection, sid: str) -> list[str]:
    """Связь кончилась: учитель больше не видит ученика, записи удаляются, оценки у ученика остаются."""
    drop_partner(c, sid)
    files = drop_waiting(c, "student=?", (sid,)) + drop_audio(c, "student=?", (sid,))
    c.execute("DELETE FROM links WHERE student=?", (sid,))
    return files


@app.patch("/api/students/{sid}/join")
def change_consent(sid: Id, body: ConsentIn, me: Me):
    files = []
    with db() as c:
        my_student(c, me, sid)
        if body.consent is not None:
            c.execute("UPDATE links SET consent=? WHERE student=?", (now() if body.consent else None, sid))
        if body.consent is False:
            c.execute("UPDATE links SET partner_consent=NULL WHERE student=?", (sid,))
            files = drop_waiting(c, "student=?", (sid,)) + drop_audio(c, "student=?", (sid,))
        if body.partnerConsent:
            c.execute(
                "UPDATE links SET partner_consent=? WHERE student=? AND partner IS NOT NULL AND consent IS NOT NULL", (now(), sid)
            )
        elif body.partnerConsent is False:
            c.execute("UPDATE links SET partner_consent=NULL WHERE student=?", (sid,))
            files += drop_waiting(c, "student=? AND partner IS NOT NULL", (sid,))
    remove_files(files)
    return {"ok": True}


@app.delete("/api/students/{sid}/join")
def leave(sid: Id, me: Me):
    with db() as c:
        my_student(c, me, sid)
        files = unlink(c, sid)
    remove_files(files)
    return {"ok": True}


# ---------- сдача учителю ----------


def check_pages(student: sqlite3.Row, m: "Meta | PlanItem"):
    """Страницы сдачи есть в мусхафе ученика: иначе кабинет учителя не смог бы её открыть."""
    if any(r.page > PAGES[json.loads(student["data"])["mushaf"]] for r in m.ranges):
        raise HTTPException(422, "no such page")


def owner_tg(c: sqlite3.Connection, sid: str) -> int | None:
    r = c.execute("SELECT a.tg_id FROM students s JOIN accounts a ON a.id=s.account WHERE s.id=?", (sid,)).fetchone()
    return r["tg_id"] if r else None


def to_partner(link: sqlite3.Row, kind: str) -> str | None:
    """Недавнее и давнее принимает напарник, если он есть; остальное учитель."""
    return link["partner"] if kind in REVISION else None


@app.post("/api/students/{sid}/submissions")
def send(sid: Id, me: Me, meta: Annotated[str, Form(max_length=20000)], audio: Annotated[UploadFile, File()]):
    try:
        m = Meta.model_validate_json(meta)
    except ValidationError:
        raise HTTPException(422, "bad meta")
    mime = (audio.content_type or "").split(";")[0].strip()
    if mime not in AUDIO_TYPES:
        raise HTTPException(415, "not audio")
    with db() as c:
        check_pages(my_student(c, me, sid), m)
        link = c.execute("SELECT * FROM links WHERE student=? AND status='active'", (sid,)).fetchone()
        if not link:
            raise HTTPException(409, "no teacher")
        if link["consent"] is None or (to_partner(link, m.kind) and link["partner_consent"] is None):
            raise HTTPException(403, "no consent")
    used = sum(e.stat().st_size for e in os.scandir(AUDIO))
    if used > MAX_AUDIO_TOTAL:
        raise HTTPException(507, "storage full")
    name = secrets.token_hex(16)
    raw = os.path.join(AUDIO, name + ".raw")
    size = 0
    try:
        with open(os.open(raw, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as f:
            while chunk := audio.file.read(1 << 20):
                size += len(chunk)
                if size > MAX_AUDIO:
                    raise HTTPException(413, "too large")
                f.write(chunk)
        if size == 0:
            raise HTTPException(400, "empty")
        try:
            transcode(raw, os.path.join(AUDIO, name))
        except subprocess.TimeoutExpired:
            raise HTTPException(413, "too long")
        with db() as c:
            # Пока файл загружался, связь или разрешение могли снять.
            link = c.execute(
                "SELECT l.*, a.tg_id FROM links l JOIN accounts a ON a.id=l.teacher"
                " JOIN students s ON s.id=l.student"
                " WHERE l.student=? AND l.status='active' AND l.consent IS NOT NULL AND s.account=?", (sid, me["id"]),
            ).fetchone()
            if not link:
                raise HTTPException(409, "no teacher")
            partner = to_partner(link, m.kind)
            # Напарника назначили, пока шла загрузка: разрешения на него ещё нет.
            if partner and link["partner_consent"] is None:
                raise HTTPException(409, "no consent")
            # Новая запись того же вида заменяет непроверенную.
            old = drop_waiting(c, "student=? AND kind=?", (sid, m.kind))
            subid = secrets.token_urlsafe(12)
            c.execute(
                "INSERT INTO submissions (id,student,teacher,kind,meta,audio,mime,status,created,partner)"
                " VALUES (?,?,?,?,?,?,?,'waiting',?,?)",
                (subid, sid, link["teacher"], m.kind, m.dump(), name, "audio/mp4", now(), partner),
            )
            if partner:
                tg = owner_tg(c, partner)
                text = "Напарник прислал сдачу. Откройте приложение, чтобы проверить."
            else:
                tg = link["tg_id"]
                n = c.execute(
                    "SELECT COUNT(*) FROM submissions WHERE teacher=? AND status='waiting' AND partner IS NULL", (link["teacher"],)
                ).fetchone()[0]
                text = f"Новая сдача ждёт проверки. Всего ждёт: {n}."
    except BaseException:
        remove_files([name])
        raise
    finally:
        remove_files([name + ".raw"])
    remove_files(old)
    notify(tg, text)
    return {"id": subid}


@app.delete("/api/submissions/{subid}")
def withdraw(subid: Id, me: Me):
    with db() as c:
        r = c.execute(
            "SELECT b.id FROM submissions b JOIN students s ON s.id=b.student WHERE b.id=? AND s.account=? AND b.status='waiting'",
            (subid, me["id"]),
        ).fetchone()
        if not r:
            raise HTTPException(404, "no submission")
        files = drop_waiting(c, "id=?", (subid,))
    remove_files(files)
    return {"ok": True}


@app.get("/api/submissions/{subid}/audio")
def get_audio(subid: Id, me: Me):
    """Запись слышат сам ученик, его нынешний учитель и напарник, пока запись у него на проверке."""
    with db() as c:
        r = c.execute(
            "SELECT b.audio, b.mime FROM submissions b JOIN students s ON s.id=b.student"
            " LEFT JOIN links l ON l.student=b.student AND l.teacher=b.teacher AND l.status='active'"
            " LEFT JOIN students p ON p.id=b.partner AND p.deleted=0 AND b.status='waiting'"
            " WHERE b.id=? AND b.audio IS NOT NULL AND (s.account=? OR (l.student IS NOT NULL AND (b.teacher=?"
            " OR (p.account=? AND l.partner=b.partner AND l.partner_consent IS NOT NULL))))",
            (subid, me["id"], me["id"], me["id"]),
        ).fetchone()
    if not r:
        raise HTTPException(404, "no audio")
    path = os.path.join(AUDIO, r["audio"])
    if not os.path.exists(path):
        raise HTTPException(404, "no audio")
    return FileResponse(path, media_type=r["mime"], headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"})


# ---------- кабинет учителя ----------


def my_pupil(c: sqlite3.Connection, me: sqlite3.Row, sid: str) -> sqlite3.Row:
    r = c.execute(
        "SELECT s.*, a.tg_id FROM links l JOIN students s ON s.id=l.student JOIN accounts a ON a.id=s.account"
        " WHERE l.student=? AND l.teacher=? AND l.status='active'", (sid, me["id"]),
    ).fetchone()
    if not r:
        raise HTTPException(404, "no student")
    return r


def new_group(c: sqlite3.Connection, teacher_id: str, name: str) -> str:
    gid = secrets.token_urlsafe(9)
    c.execute("INSERT INTO groups VALUES (?,?,?,?,?)", (gid, teacher_id, name, code(10), now()))
    return gid


def my_group(c: sqlite3.Connection, me: sqlite3.Row, gid: str) -> sqlite3.Row:
    g = c.execute("SELECT * FROM groups WHERE id=? AND teacher=?", (gid, me["id"])).fetchone()
    if not g:
        raise HTTPException(404, "no group")
    return g


@app.post("/api/groups")
def create_group(body: NameIn, me: Me):
    with db() as c:
        if me["role"] != "teacher":
            raise HTTPException(403, "not a teacher")
        if c.execute("SELECT COUNT(*) FROM groups WHERE teacher=?", (me["id"],)).fetchone()[0] >= 30:
            raise HTTPException(409, "too many groups")
        return {"id": new_group(c, me["id"], body.name.strip() or "Группа")}


@app.patch("/api/groups/{gid}")
def rename_group(gid: Id, body: NameIn, me: Me):
    with db() as c:
        g = my_group(c, me, gid)
        c.execute("UPDATE groups SET name=? WHERE id=?", (body.name.strip() or g["name"], gid))
    return {"ok": True}


@app.post("/api/groups/{gid}/link")
def renew_link(gid: Id, me: Me):
    """Новая ссылка: по старой больше не записаться. Кто уже в группе, остаётся."""
    with db() as c:
        my_group(c, me, gid)
        c.execute("UPDATE groups SET code=? WHERE id=?", (code(10), gid))
    return {"ok": True}


@app.delete("/api/groups/{gid}")
def delete_group(gid: Id, me: Me):
    with db() as c:
        my_group(c, me, gid)
        if c.execute("SELECT 1 FROM links WHERE grp=?", (gid,)).fetchone():
            raise HTTPException(409, "not empty")
        c.execute("DELETE FROM groups WHERE id=?", (gid,))
    return {"ok": True}


@app.get("/api/teacher")
def teacher(me: Me):
    with db() as c:
        rows = c.execute(
            "SELECT l.status, l.consent, l.grp, l.partner, l.created AS asked, s.id, s.data, s.updated FROM links l JOIN students s ON s.id=l.student"
            " WHERE l.teacher=? AND s.deleted=0 ORDER BY l.created", (me["id"],),
        ).fetchall()
        subs = c.execute(
            "SELECT b.* FROM submissions b JOIN links l ON l.student=b.student AND l.teacher=b.teacher AND l.status='active'"
            " WHERE b.teacher=? AND b.status='waiting' ORDER BY b.created", (me["id"],),
        ).fetchall()
        done = c.execute(
            "SELECT b.* FROM submissions b JOIN links l ON l.student=b.student AND l.teacher=b.teacher AND l.status='active'"
            " WHERE b.teacher=? AND b.status='checked' AND b.checked>? ORDER BY b.checked", (me["id"], now() - 120 * 86400),
        ).fetchall()
        groups = c.execute("SELECT * FROM groups WHERE teacher=? ORDER BY created, rowid", (me["id"],)).fetchall()
    bot = bot_name()
    # Решения, которые телефон ученика ещё не забрал: без них учитель видел бы урок несданным.
    seen = {r["id"]: {x["id"] for x in json.loads(r["data"])["submissions"]} for r in rows if r["status"] == "active"}
    return {
        "fresh": [sub_json(r) for r in done if r["id"] not in seen[r["student"]]],
        "groups": [
            {"id": g["id"], "name": g["name"],
             "link": f"https://t.me/{bot}?start=join_{g['code']}" if bot else f"{APP_URL}/?join={g['code']}"}
            for g in groups
        ],
        # До подтверждения учитель видит только имя.
        "requests": [{"id": r["id"], "name": json.loads(r["data"])["name"], "group": r["grp"], "created": r["asked"]} for r in rows if r["status"] == "pending"],
        "students": [
            {"data": json.loads(r["data"]), "group": r["grp"], "updated": r["updated"], "consent": r["consent"] is not None,
             "partner": r["partner"]}
            for r in rows if r["status"] == "active"
        ],
        "inbox": [sub_json(r) for r in subs],
    }


class AcceptIn(BaseModel):
    accept: bool


@app.post("/api/teacher/students/{sid}")
def answer_request(sid: Id, body: AcceptIn, me: Me):
    with db() as c:
        link = c.execute("SELECT * FROM links WHERE student=? AND teacher=? AND status='pending'", (sid, me["id"])).fetchone()
        if not link:
            raise HTTPException(404, "no request")
        if body.accept:
            c.execute("UPDATE links SET status='active' WHERE student=?", (sid,))
            notify(my_pupil(c, me, sid)["tg_id"], "Учитель принял вас в группу.")
        else:
            c.execute("DELETE FROM links WHERE student=?", (sid,))
    return {"ok": True}


class PupilPatch(BaseModel):
    group: Id | None = None
    partner: Id | None = None


@app.patch("/api/teacher/students/{sid}")
def change_pupil(sid: Id, body: PupilPatch, me: Me):
    """Перевести в другую группу; назначить напарника или снять его (partner: null)."""
    with db() as c:
        pupil = my_pupil(c, me, sid)
        link = c.execute("SELECT * FROM links WHERE student=?", (sid,)).fetchone()
        if body.group and body.group != link["grp"]:
            my_group(c, me, body.group)
            drop_partner(c, sid)
            c.execute("UPDATE links SET grp=? WHERE student=?", (body.group, sid))
        if "partner" in body.model_fields_set and body.partner != link["partner"]:
            if body.partner:
                mate = my_pupil(c, me, body.partner)
                grp = c.execute("SELECT grp FROM links WHERE student=?", (body.partner,)).fetchone()["grp"]
                # Себе и детям своего же аккаунта не сдают.
                if mate["account"] == pupil["account"] or grp != c.execute("SELECT grp FROM links WHERE student=?", (sid,)).fetchone()["grp"]:
                    raise HTTPException(409, "bad partner")
                notify(pupil["tg_id"], "Учитель назначил напарника. Откройте приложение.")
                notify(mate["tg_id"], "Учитель назначил вас напарником: принимайте недавнее и давнее. Откройте приложение.")
            # Разрешение на запись давали прежнему напарнику, новому его спрашивают заново.
            c.execute("UPDATE submissions SET partner=NULL WHERE student=? AND status='waiting'", (sid,))
            c.execute("UPDATE links SET partner=?, partner_consent=NULL WHERE student=?", (body.partner, sid))
    return {"ok": True}


@app.delete("/api/teacher/students/{sid}")
def expel(sid: Id, me: Me):
    with db() as c:
        my_pupil(c, me, sid)
        files = unlink(c, sid)
    remove_files(files)
    return {"ok": True}


@app.post("/api/teacher/submissions/{subid}")
def check(subid: Id, body: Verdict, me: Me):
    with db() as c:
        r = c.execute("SELECT * FROM submissions WHERE id=? AND teacher=? AND status='waiting'", (subid, me["id"])).fetchone()
        if not r:
            raise HTTPException(404, "no submission")
        pupil = my_pupil(c, me, r["student"])
        c.execute(
            "UPDATE submissions SET status='checked', verdict=?, checked=? WHERE id=?", (body.dump(), now(), subid)
        )
        notify(pupil["tg_id"], "Учитель проверил сдачу. Откройте приложение, чтобы увидеть оценку.")
    return {"ok": True}


class InPerson(BaseModel):
    meta: Meta
    verdict: Verdict


@app.post("/api/teacher/students/{sid}/check")
def check_in_person(sid: Id, body: InPerson, me: Me):
    """Ученик сдал рядом с учителем, без записи."""
    with db() as c:
        check_pages(my_pupil(c, me, sid), body.meta)
        files = drop_waiting(c, "student=? AND kind=?", (sid, body.meta.kind))
        subid = secrets.token_urlsafe(12)
        c.execute(
            "INSERT INTO submissions (id,student,teacher,kind,meta,status,verdict,created,checked) VALUES (?,?,?,?,?,'checked',?,?,?)",
            (subid, sid, me["id"], body.meta.kind, body.meta.dump(), body.verdict.dump(), now(), now()),
        )
    remove_files(files)
    return {"id": subid}


# ---------- напарник ----------


def last_passed(c: sqlite3.Connection, sid: str) -> dict:
    """Когда последний раз приняли недавнее и давнее, по записям сервера."""
    out: dict = {}
    for r in c.execute(
        "SELECT kind, meta, verdict FROM submissions WHERE student=? AND status='checked' AND kind IN ('sabki','manzil') AND checked>?",
        (sid, now() - 3 * 86400),
    ):
        if json.loads(r["verdict"])["passed"]:
            out[r["kind"]] = max(out.get(r["kind"], ""), json.loads(r["meta"])["date"])
    return out


def partner_pupils(c: sqlite3.Connection, me: sqlite3.Row) -> list[dict]:
    """У кого я (мой ученик) принимаю недавнее и давнее. Только имя и что сдаётся, без дневника."""
    out = []
    for r in c.execute(
        "SELECT l.student, l.partner, s.data, s.plan FROM links l JOIN students s ON s.id=l.student JOIN students p ON p.id=l.partner"
        " WHERE p.account=? AND p.deleted=0 AND s.deleted=0 AND l.status='active' ORDER BY l.created", (me["id"],),
    ).fetchall():
        d, plan = json.loads(r["data"]), json.loads(r["plan"]) if r["plan"] else {}
        done = {**plan.get("done", {})}
        for k, v in last_passed(c, r["student"]).items():
            done[k] = max(done.get(k, ""), v)
        subs = c.execute(
            "SELECT * FROM submissions WHERE student=? AND partner=? AND status='waiting' ORDER BY created", (r["student"], r["partner"])
        ).fetchall()
        out.append({
            "student": r["student"], "mine": r["partner"], "name": d["name"], "mushaf": d["mushaf"], "maxErrors": d["method"]["maxErrors"],
            "sabki": plan.get("sabki"), "manzil": plan.get("manzil"), "done": done, "inbox": [sub_json(x) for x in subs],
        })
    return out


def my_mate(c: sqlite3.Connection, me: sqlite3.Row, sid: str) -> sqlite3.Row:
    r = c.execute(
        "SELECT s.*, l.teacher, l.partner, a.tg_id FROM links l JOIN students s ON s.id=l.student JOIN accounts a ON a.id=s.account"
        " JOIN students p ON p.id=l.partner WHERE l.student=? AND l.status='active' AND p.account=? AND p.deleted=0 AND s.deleted=0",
        (sid, me["id"]),
    ).fetchone()
    if not r:
        raise HTTPException(404, "no student")
    return r


@app.post("/api/partner/submissions/{subid}")
def partner_check(subid: Id, body: Verdict, me: Me):
    with db() as c:
        r = c.execute("SELECT * FROM submissions WHERE id=? AND status='waiting' AND partner IS NOT NULL", (subid,)).fetchone()
        mate = my_mate(c, me, r["student"]) if r else None
        if not r or mate["partner"] != r["partner"]:
            raise HTTPException(404, "no submission")
        c.execute("UPDATE submissions SET status='checked', verdict=?, checked=? WHERE id=?", (body.dump("partner"), now(), subid))
        notify(mate["tg_id"], "Напарник проверил сдачу. Откройте приложение, чтобы увидеть оценку.")
    return {"ok": True}


@app.post("/api/partner/students/{sid}/check")
def partner_in_person(sid: Id, body: InPerson, me: Me):
    if body.meta.kind not in REVISION:
        raise HTTPException(403, "teacher only")
    with db() as c:
        mate = my_mate(c, me, sid)
        check_pages(mate, body.meta)
        files = drop_waiting(c, "student=? AND kind=?", (sid, body.meta.kind))
        subid = secrets.token_urlsafe(12)
        c.execute(
            "INSERT INTO submissions (id,student,teacher,kind,meta,status,verdict,created,checked,partner)"
            " VALUES (?,?,?,?,?,'checked',?,?,?,?)",
            (subid, sid, mate["teacher"], body.meta.kind, body.meta.dump(), body.verdict.dump("partner"), now(), now(), mate["partner"]),
        )
    remove_files(files)
    return {"id": subid}


# ---------- напоминания ----------

ZONES = zoneinfo.available_timezones()
DEFAULT_TZ = "Asia/Almaty"


def remind(t: int):
    """Утреннее напоминание: что повторить сегодня. Сдавшему или уже пославшему запись не пишем."""
    with db() as c:
        rows = c.execute(
            "SELECT s.id, s.plan, s.data, s.reminded, s.account, a.tg_id FROM students s JOIN accounts a ON a.id=s.account"
            " WHERE s.plan IS NOT NULL AND s.deleted=0 AND a.muted=0 AND a.tg_id IS NOT NULL"
        ).fetchall()
        many = {r["account"] for r in c.execute("SELECT account FROM students WHERE deleted=0 GROUP BY account HAVING COUNT(*)>1")}
        for r in rows:
            plan = json.loads(r["plan"])
            if not plan["at"]:
                continue
            local = datetime.fromtimestamp(t, zoneinfo.ZoneInfo(plan["tz"]))
            date = local.strftime("%Y-%m-%d")
            h, m = plan["at"].split(":")
            late = local.hour * 60 + local.minute - int(h) * 60 - int(m)
            # Окно 10 минут: служба могла перезапускаться в нужную минуту.
            if not 0 <= late < 10 or r["reminded"] == date:
                continue
            c.execute("UPDATE students SET reminded=? WHERE id=?", (date, r["id"]))
            done = last_passed(c, r["id"])
            sent = {
                x["kind"] for x in c.execute("SELECT kind, meta FROM submissions WHERE student=? AND status='waiting'", (r["id"],))
                if json.loads(x["meta"])["date"] == date
            }
            lines = [
                plan[k]["text"] for k in REVISION
                if plan.get(k) and k not in sent and date not in (plan["done"].get(k), done.get(k))
            ]
            if lines:
                # Имя нужно, только когда с одного аккаунта учатся несколько детей.
                name = [json.loads(r["data"])["name"]] if r["account"] in many else []
                notify(r["tg_id"], "\n".join([*name, plan["head"], *lines]))


def remind_forever():
    while True:
        try:
            remind(now())
        except Exception as e:  # noqa: BLE001
            print(f"remind: {type(e).__name__}: {e}", flush=True)
        time.sleep(30)


if os.environ.get("REMIND", "1") == "1":
    threading.Thread(target=remind_forever, daemon=True).start()


class MuteIn(BaseModel):
    tg_id: int
    muted: bool


@app.post("/internal/mute", dependencies=[Depends(from_bot)])
def bot_mute(body: MuteIn):
    """/stop и /start в боте."""
    with db() as c:
        c.execute("UPDATE accounts SET muted=? WHERE tg_id=?", (int(body.muted), body.tg_id))
    return {"ok": True}


@app.post("/internal/personal", dependencies=[Depends(from_bot)])
def bot_personal():
    """Кому утренний план шлёт сервер: общее напоминание бота о недавнем и давнем им не нужно."""
    with db() as c:
        rows = c.execute(
            "SELECT a.tg_id, s.plan FROM students s JOIN accounts a ON a.id=s.account"
            " WHERE s.plan IS NOT NULL AND s.deleted=0 AND a.tg_id IS NOT NULL"
        ).fetchall()
    return {"ids": sorted({r["tg_id"] for r in rows if any(json.loads(r["plan"]).get(k) for k in REVISION)})}


@app.get("/api/health")
def health():
    with db() as c:
        c.execute("SELECT 1")
    return {"ok": True}

"""Аккаунты, прогресс учеников, группы учителей и сдачи. Работает службой quran-api (порт 8091).

Кто чем управляет:
- прогресс ученика (students.data) пишет только аккаунт самого ученика; учитель его читает;
- решение учителя хранится в submissions, приложение ученика забирает его и засчитывает у себя.

Вход: Telegram (подпись initData проверяется токеном бота) или одноразовый код с другого устройства.
Учитель видит ученика, только если тот ввёл код учителя и учитель его принял.
Запись голоса принимается только с разрешения (links.consent) и удаляется через 30 дней после проверки.
"""

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
from contextlib import contextmanager
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
CODE_SECONDS = 600
KEEP_CHECKED = 30 * 86400
KEEP_WAITING = 60 * 86400
PAGES = {"madani": 604, "indopak": 610}
# Без похожих символов: 0 и O, 1, I и L.
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
AUDIO_TYPES = {"video/webm", "audio/webm", "audio/mp4", "audio/ogg", "audio/mpeg", "audio/wav", "audio/aac"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY, tg_id INTEGER UNIQUE, name TEXT NOT NULL, role TEXT, teacher_code TEXT UNIQUE, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_codes (hash TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  data TEXT, rev INTEGER NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS links (
  student TEXT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  teacher TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  status TEXT NOT NULL, consent INTEGER, created INTEGER NOT NULL);
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


class Hifz(Loose):
    memorized: list[Annotated[int, Field(ge=1, le=610)]] = Field(max_length=700)
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
    mushaf: Literal["madani", "indopak"]
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
        pages = [*h.memorized, h.cur.page, self.nazira.next, *self.nazira.read, *(r.page for r in ranges)]
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


class Verdict(BaseModel):
    marks: dict[Annotated[str, Field(pattern=r"^\d{1,3}:\d{1,2}:\d{1,2}$")], Literal[1, 2]] = Field(max_length=3000)
    grade: Annotated[int, Field(ge=0, le=10)]
    passed: bool
    comment: str = Field(default="", max_length=500)

    def dump(self) -> str:
        v = self.model_dump()
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


_bot_name: str | None = None


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
    return {"id": a["id"], "name": a["name"], "role": a["role"], "code": a["teacher_code"], "telegram": a["tg_id"] is not None}


def signed_in(c: sqlite3.Connection, aid: str) -> dict:
    a = c.execute("SELECT * FROM accounts WHERE id=?", (aid,)).fetchone()
    return {"token": new_token(c, aid), "account": account_json(a)}


class TgIn(BaseModel):
    initData: str = Field(max_length=8000)


class NameIn(BaseModel):
    name: Name


class RedeemIn(BaseModel):
    code: str = Field(max_length=32)
    initData: str | None = Field(default=None, max_length=8000)


@app.post("/api/auth/telegram")
def auth_telegram(body: TgIn):
    u = telegram_user(body.initData)
    with db() as c:
        a = c.execute("SELECT id FROM accounts WHERE tg_id=?", (u["id"],)).fetchone()
        return signed_in(c, a["id"] if a else new_account(c, u["name"], u["id"]))


@app.post("/api/auth/new")
def auth_new(body: NameIn):
    with db() as c:
        return signed_in(c, new_account(c, body.name.strip(), None))


@app.post("/api/auth/code")
def auth_code(me: Me):
    """Код, чтобы войти в этот же аккаунт на другом устройстве."""
    value = code(8)
    with db() as c:
        c.execute("DELETE FROM login_codes WHERE account=? OR expires<?", (me["id"], now()))
        c.execute("INSERT INTO login_codes VALUES (?,?,?)", (sha(value), me["id"], now() + CODE_SECONDS))
    return {"code": value, "seconds": CODE_SECONDS}


@app.post("/api/auth/redeem")
def auth_redeem(body: RedeemIn, authorization: Annotated[str | None, Header()] = None):
    tg = telegram_user(body.initData) if body.initData else None
    with db() as c:
        row = c.execute(
            "SELECT account FROM login_codes WHERE hash=? AND expires>=?", (sha(clean_code(body.code)), now())
        ).fetchone()
        if not row:
            raise HTTPException(404, "bad code")
        target = row["account"]
        c.execute("DELETE FROM login_codes WHERE account=?", (target,))
        # Устройство уже вошло в другой аккаунт: его ученики и группа переезжают в тот, чей код введён.
        mine = account_by_token(c, authorization)
        if mine and mine["id"] != target:
            merge_accounts(c, mine["id"], target)
        if tg:
            other = c.execute("SELECT id FROM accounts WHERE tg_id=?", (tg["id"],)).fetchone()
            if not other:
                c.execute("UPDATE accounts SET tg_id=? WHERE id=? AND tg_id IS NULL", (tg["id"], target))
        return signed_in(c, target)


def merge_accounts(c: sqlite3.Connection, src: str, dst: str):
    a = c.execute("SELECT * FROM accounts WHERE id=?", (src,)).fetchone()
    b = c.execute("SELECT * FROM accounts WHERE id=?", (dst,)).fetchone()
    c.execute("UPDATE students SET account=? WHERE account=?", (dst, src))
    c.execute("UPDATE links SET teacher=? WHERE teacher=?", (dst, src))
    c.execute("UPDATE submissions SET teacher=? WHERE teacher=?", (dst, src))
    c.execute("DELETE FROM accounts WHERE id=?", (src,))
    c.execute(
        "UPDATE accounts SET tg_id=?, role=?, teacher_code=? WHERE id=?",
        (b["tg_id"] or a["tg_id"], b["role"] or a["role"], b["teacher_code"] or a["teacher_code"], dst),
    )


@app.post("/api/auth/logout")
def logout(me: Me, authorization: Annotated[str | None, Header()] = None):
    with db() as c:
        c.execute("DELETE FROM tokens WHERE hash=?", (sha(authorization[7:]),))
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
        if body.role == "teacher" and not me["teacher_code"]:
            while True:
                value = code(6)
                if not c.execute("SELECT 1 FROM accounts WHERE teacher_code=?", (value,)).fetchone():
                    break
            c.execute("UPDATE accounts SET teacher_code=? WHERE id=?", (value, me["id"]))
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
        c.execute("DELETE FROM login_codes WHERE expires<?", (t,))
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
            "SELECT l.*, a.name FROM links l JOIN students s ON s.id=l.student JOIN accounts a ON a.id=l.teacher WHERE s.account=?",
            (me["id"],),
        ).fetchall()
        subs = c.execute(
            "SELECT b.* FROM submissions b JOIN students s ON s.id=b.student"
            " WHERE s.account=? AND (b.status='waiting' OR b.checked>?) ORDER BY b.created DESC LIMIT 500",
            (me["id"], now() - 120 * 86400),
        ).fetchall()
        a = c.execute("SELECT * FROM accounts WHERE id=?", (me["id"],)).fetchone()
    return {
        "account": account_json(a),
        "students": [{"id": r["id"], "rev": r["rev"], "data": json.loads(r["data"])} for r in rows if not r["deleted"]],
        "deleted": [r["id"] for r in rows if r["deleted"]],
        "links": [
            {"student": r["student"], "teacher": r["name"], "status": r["status"], "consent": r["consent"] is not None}
            for r in links
        ],
        "waiting": [sub_json(r) for r in subs if r["status"] == "waiting"],
        "verdicts": [sub_json(r) for r in reversed(subs) if r["status"] == "checked"],
    }


def sub_json(r: sqlite3.Row) -> dict:
    out = {
        "id": r["id"], "student": r["student"], **json.loads(r["meta"]),
        "audio": r["audio"] is not None, "created": r["created"],
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
            c.execute("INSERT INTO students VALUES (?,?,?,1,?,0)", (sid, me["id"], raw, now()))
            return {"rev": 1}
        if s["account"] != me["id"]:
            raise HTTPException(403, "other account")
        if s["deleted"]:
            raise HTTPException(410, "deleted")
        if s["rev"] != body.rev:
            raise HTTPException(409, {"rev": s["rev"], "data": json.loads(s["data"])})
        c.execute("UPDATE students SET data=?, rev=rev+1, updated=? WHERE id=?", (raw, now(), sid))
        return {"rev": s["rev"] + 1}


@app.delete("/api/students/{sid}")
def delete_student(sid: Id, me: Me):
    with db() as c:
        my_student(c, me, sid)
        files = audio_names(c, "student=?", (sid,))
        c.execute("DELETE FROM submissions WHERE student=?", (sid,))
        c.execute("DELETE FROM links WHERE student=?", (sid,))
        # Пустая метка остаётся, чтобы удаление дошло до других устройств.
        c.execute("UPDATE students SET data=NULL, deleted=1, updated=? WHERE id=?", (now(), sid))
    remove_files(files)
    return {"ok": True}


# ---------- связь с учителем ----------


class JoinIn(BaseModel):
    code: str = Field(max_length=32)
    consent: bool


class ConsentIn(BaseModel):
    consent: bool


@app.get("/api/teachers/{value}")
def find_teacher(value: str, me: Me):
    """Имя учителя по его коду, чтобы ученик увидел, к кому записывается."""
    with db() as c:
        t = c.execute("SELECT name FROM accounts WHERE teacher_code=?", (clean_code(value),)).fetchone()
    if not t:
        raise HTTPException(404, "no teacher")
    return {"name": t["name"]}


@app.post("/api/students/{sid}/join")
def join(sid: Id, body: JoinIn, me: Me):
    with db() as c:
        my_student(c, me, sid)
        t = c.execute("SELECT * FROM accounts WHERE teacher_code=?", (clean_code(body.code),)).fetchone()
        if not t:
            raise HTTPException(404, "no teacher")
        old = c.execute("SELECT * FROM links WHERE student=?", (sid,)).fetchone()
        consent = now() if body.consent else None
        files = []
        if old and old["teacher"] == t["id"]:
            c.execute("UPDATE links SET consent=? WHERE student=?", (consent, sid))
        else:
            if old:
                files = unlink(c, sid)
            c.execute("INSERT INTO links VALUES (?,?,'pending',?,?)", (sid, t["id"], consent, now()))
            notify(t["tg_id"], "Новый ученик просится в группу. Откройте кабинет учителя.")
    remove_files(files)
    return {"ok": True}


def unlink(c: sqlite3.Connection, sid: str) -> list[str]:
    """Связь кончилась: учитель больше не видит ученика, записи удаляются, оценки у ученика остаются."""
    files = drop_waiting(c, "student=?", (sid,)) + drop_audio(c, "student=?", (sid,))
    c.execute("DELETE FROM links WHERE student=?", (sid,))
    return files


@app.patch("/api/students/{sid}/join")
def change_consent(sid: Id, body: ConsentIn, me: Me):
    with db() as c:
        my_student(c, me, sid)
        c.execute("UPDATE links SET consent=? WHERE student=?", (now() if body.consent else None, sid))
        files = [] if body.consent else drop_waiting(c, "student=?", (sid,)) + drop_audio(c, "student=?", (sid,))
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


def check_pages(student: sqlite3.Row, m: Meta):
    """Страницы сдачи есть в мусхафе ученика: иначе кабинет учителя не смог бы её открыть."""
    if any(r.page > PAGES[json.loads(student["data"])["mushaf"]] for r in m.ranges):
        raise HTTPException(422, "no such page")


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
        if link["consent"] is None:
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
            # Новая запись того же вида заменяет непроверенную.
            old = drop_waiting(c, "student=? AND kind=?", (sid, m.kind))
            subid = secrets.token_urlsafe(12)
            c.execute(
                "INSERT INTO submissions VALUES (?,?,?,?,?,?,?,'waiting',NULL,?,NULL)",
                (subid, sid, link["teacher"], m.kind, m.dump(), name, "audio/mp4", now()),
            )
            n = c.execute(
                "SELECT COUNT(*) FROM submissions WHERE teacher=? AND status='waiting'", (link["teacher"],)
            ).fetchone()[0]
    except BaseException:
        remove_files([name])
        raise
    finally:
        remove_files([name + ".raw"])
    remove_files(old)
    notify(link["tg_id"], f"Новая сдача ждёт проверки. Всего ждёт: {n}.")
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
    """Запись слышат сам ученик и его нынешний учитель."""
    with db() as c:
        r = c.execute(
            "SELECT b.audio, b.mime FROM submissions b JOIN students s ON s.id=b.student"
            " LEFT JOIN links l ON l.student=b.student AND l.teacher=b.teacher AND l.status='active'"
            " WHERE b.id=? AND b.audio IS NOT NULL AND (s.account=? OR (b.teacher=? AND l.student IS NOT NULL))",
            (subid, me["id"], me["id"]),
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


@app.get("/api/teacher")
def teacher(me: Me):
    with db() as c:
        rows = c.execute(
            "SELECT l.status, l.consent, l.created AS asked, s.id, s.data, s.updated FROM links l JOIN students s ON s.id=l.student"
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
    bot = bot_name()
    # Решения, которые телефон ученика ещё не забрал: без них учитель видел бы урок несданным.
    seen = {r["id"]: {x["id"] for x in json.loads(r["data"])["submissions"]} for r in rows if r["status"] == "active"}
    return {
        "fresh": [sub_json(r) for r in done if r["id"] not in seen[r["student"]]],
        "code": me["teacher_code"],
        "link": f"https://t.me/{bot}?start=join_{me['teacher_code']}" if bot and me["teacher_code"] else None,
        # До подтверждения учитель видит только имя.
        "requests": [{"id": r["id"], "name": json.loads(r["data"])["name"], "created": r["asked"]} for r in rows if r["status"] == "pending"],
        "students": [
            {"data": json.loads(r["data"]), "updated": r["updated"], "consent": r["consent"] is not None}
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
            "INSERT INTO submissions VALUES (?,?,?,?,?,NULL,NULL,'checked',?,?,?)",
            (subid, sid, me["id"], body.meta.kind, body.meta.dump(), body.verdict.dump(), now(), now()),
        )
    remove_files(files)
    return {"id": subid}


@app.get("/api/health")
def health():
    with db() as c:
        c.execute("SELECT 1")
    return {"ok": True}

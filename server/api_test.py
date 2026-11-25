"""Проверка сервера: python -m pytest server/api_test.py (нужны fastapi, httpx, pytest, python-multipart)."""

import hashlib
import hmac
import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.parse

os.environ["API_DATA"] = tempfile.mkdtemp()
os.environ["BOT_TOKEN"] = "1:test"

import api  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

sent: list[tuple] = []
api.notify = lambda tg, text: sent.append((tg, text))
api.bot_name = lambda: "test_bot"
real_transcode = api.transcode
api.transcode = lambda src, dst: shutil.copy(src, dst)
http = TestClient(api.app)
_n = 0


def uid(prefix="student"):
    global _n
    _n += 1
    return f"{prefix}{_n:04d}"


def student(sid, **kw):
    d = {
        "id": sid, "name": "Али", "mushaf": "madani", "stage": "hifz", "volume": "page", "direction": 1,
        "method": {"maxErrors": 2, "sabkiPages": 10, "manzilJuz": 2, "dailyTarget": 200, "morningStart": "08:00", "morningEnd": "10:00"},
        "nazira": {"next": 1, "read": []},
        "hifz": {"memorized": [1], "cur": {"page": 2, "line": 0}, "pending": {"page": 2, "from": 0, "to": 15}, "lesson": None, "manzilCursor": 0},
        "submissions": [], "days": {"2026-11-25": {"reps": 5, "seconds": {"sabak": 10}, "learned": []}}, "updatedAt": 1,
    }
    return {**d, **kw}


META = {"kind": "sabak", "ranges": [{"page": 2, "from": 0, "to": 15}], "fromVerse": "2:1", "toVerse": "2:5", "date": "2026-11-25", "peeks": 1, "seconds": 60}
VERDICT = {"marks": {"2:0:1": 1, "2:1:0": 2}, "grade": 3, "passed": True, "comment": "Тяни мадд"}


class User:
    def __init__(self, name="Имя"):
        self.tg = int(uid("")[-4:]) + 1000
        self.use(http.post("/api/auth/telegram", json={"initData": init_data(self.tg, name=name)}).json())

    def use(self, r):
        self.token, self.account = r["token"], r["account"]

    def __call__(self, method, path, **kw):
        return http.request(method, "/api" + path, headers={"Authorization": "Bearer " + self.token}, **kw)

    def add(self, sid=None, **kw):
        sid = sid or uid()
        r = self("PUT", f"/students/{sid}", json={"rev": 0, "data": student(sid, **kw)})
        assert r.status_code == 200, r.text
        return sid

    def teacher(self):
        self.account = self("PATCH", "/me", json={"role": "teacher"}).json()
        return self.codes()[0]

    def codes(self):
        return [g["link"].split("join_")[1] for g in self("GET", "/teacher").json()["groups"]]

    def send(self, sid, meta=META, data=b"voice", mime="audio/webm"):
        return self("POST", f"/students/{sid}/submissions", data={"meta": json.dumps(meta)}, files={"audio": ("a", data, mime)})


def pair(consent=True):
    t, s = User("Устаз"), User()
    code, sid = t.teacher(), s.add()
    assert s("POST", f"/students/{sid}/join", json={"code": code, "consent": consent}).status_code == 200
    assert t("POST", f"/teacher/students/{sid}", json={"accept": True}).status_code == 200
    return t, s, sid


def files():
    return set(os.listdir(api.AUDIO))


def init_data(uid_, token="1:test", age=0, name="Адик"):
    d = {"auth_date": str(int(time.time()) - age), "query_id": "x", "signature": "s", "user": json.dumps({"id": uid_, "first_name": name})}
    key = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    d["hash"] = hmac.new(key, "\n".join(f"{k}={d[k]}" for k in sorted(d)).encode(), hashlib.sha256).hexdigest()
    return urllib.parse.urlencode(d)


def test_telegram():
    ok = http.post("/api/auth/telegram", json={"initData": init_data(5)})
    assert ok.status_code == 200 and ok.json()["account"]["name"] == "Адик"
    again = http.post("/api/auth/telegram", json={"initData": init_data(5)})
    assert again.json()["account"]["id"] == ok.json()["account"]["id"]
    for bad in (init_data(5, token="2:other"), init_data(5, age=90000), "", "hash=1", init_data(5).replace("5", "6", 1)):
        assert http.post("/api/auth/telegram", json={"initData": bad}).status_code == 401


def test_needs_sign_in():
    for m, p in [("GET", "/sync"), ("GET", "/teacher"), ("DELETE", "/me"), ("POST", "/auth/logout-others")]:
        assert http.request(m, "/api" + p).status_code == 401
        assert http.request(m, "/api" + p, headers={"Authorization": "Bearer zzz"}).status_code == 401


def test_logout():
    u = User()
    assert u("POST", "/auth/logout").status_code == 200
    assert u("GET", "/sync").status_code == 401


def test_sync_and_conflict():
    u = User()
    sid = u.add()
    d = student(sid, name="Вали")
    assert u("PUT", f"/students/{sid}", json={"rev": 1, "data": d}).json() == {"rev": 2}
    r = u("PUT", f"/students/{sid}", json={"rev": 1, "data": student(sid)})
    assert r.status_code == 409 and r.json()["detail"]["data"]["name"] == "Вали"
    assert u("GET", "/sync").json()["students"][0]["rev"] == 2


def test_bad_docs():
    u, sid = User(), uid()
    bad = [
        student(sid, mushaf="x"), student(sid, days={"x": {}}), student("other001"),
        student(sid, nazira={"next": 607, "read": []}), {**student(sid), "hifz": None},
    ]
    for d in bad:
        assert u("PUT", f"/students/{sid}", json={"rev": 0, "data": d}).status_code == 422
    assert u("PUT", f"/students/{sid}", json={"rev": 0, "data": student(sid, x="я" * 600_000)}).status_code == 413


def test_strangers():
    t, s, sid = pair()
    x = User()
    x.teacher()
    sub = s.send(sid).json()["id"]
    assert x("PUT", f"/students/{sid}", json={"rev": 1, "data": student(sid)}).status_code == 403
    for m, p, j in [
        ("DELETE", f"/students/{sid}", None), ("DELETE", f"/students/{sid}/join", None), ("PATCH", f"/students/{sid}/join", {"consent": True}),
        ("GET", f"/submissions/{sub}/audio", None), ("DELETE", f"/submissions/{sub}", None), ("POST", f"/teacher/submissions/{sub}", VERDICT),
        ("POST", f"/teacher/students/{sid}", {"accept": True}), ("DELETE", f"/teacher/students/{sid}", None),
        ("POST", f"/teacher/students/{sid}/check", {"meta": META, "verdict": VERDICT}),
    ]:
        assert x(m, p, json=j).status_code == 404, p
    assert x("GET", "/teacher").json()["students"] == [] and x("GET", "/teacher").json()["inbox"] == []
    # Ученик не может проверить себя сам, учитель не может менять прогресс.
    assert s("POST", f"/teacher/submissions/{sub}", json=VERDICT).status_code == 404
    assert t("PUT", f"/students/{sid}", json={"rev": 1, "data": student(sid)}).status_code == 403


def test_request_shows_only_name():
    t, s = User("Устаз"), User()
    code, sid = t.teacher(), s.add()
    assert s("GET", f"/invites/{code.lower()}").json() == {"teacher": "Устаз", "group": "Моя группа", "own": False}
    assert s("POST", f"/students/{sid}/join", json={"code": "nope", "consent": True}).status_code == 404
    s("POST", f"/students/{sid}/join", json={"code": code, "consent": True})
    box = t("GET", "/teacher").json()
    assert box["students"] == [] and set(box["requests"][0]) == {"id", "name", "group", "created"}
    assert s.send(sid).status_code == 409
    t("POST", f"/teacher/students/{sid}", json={"accept": False})
    assert s("GET", "/sync").json()["links"] == []


def test_send_and_check():
    t, s, sid = pair()
    sub = s.send(sid).json()["id"]
    box = t("GET", "/teacher").json()
    assert [x["id"] for x in box["inbox"]] == [sub] and box["students"][0]["data"]["name"] == "Али"
    assert box["groups"][0]["link"].startswith("https://t.me/test_bot?start=join_")
    for u in (t, s):
        a = u("GET", f"/submissions/{sub}/audio")
        assert a.content == b"voice" and a.headers["content-type"] == "audio/mp4"
    assert s("GET", "/sync").json()["waiting"][0]["id"] == sub
    assert t("POST", f"/teacher/submissions/{sub}", json=VERDICT).status_code == 200
    assert t("POST", f"/teacher/submissions/{sub}", json=VERDICT).status_code == 404
    r = s("GET", "/sync").json()
    assert r["waiting"] == []
    v = r["verdicts"][0]
    assert v["ranges"] == META["ranges"] and v["verdict"]["errors"] == 1 and v["verdict"]["notes"] == 1 and v["verdict"]["comment"] == "Тяни мадд"
    assert t("GET", "/teacher").json()["inbox"] == []


def test_resend_replaces_and_withdraw():
    t, s, sid = pair()
    before = files()
    s.send(sid)
    second = s.send(sid, data=b"two").json()["id"]
    assert len(files() - before) == 1
    assert [x["id"] for x in t("GET", "/teacher").json()["inbox"]] == [second]
    assert s("DELETE", f"/submissions/{second}").status_code == 200
    assert files() == before


def test_bad_audio():
    _, s, sid = pair()
    before = files()
    assert s.send(sid, mime="text/html").status_code == 415
    assert s.send(sid, data=b"").status_code == 400
    assert s.send(sid, meta={**META, "ranges": [{"page": 607, "from": 0, "to": 5}]}).status_code == 422
    assert s.send(sid, meta={**META, "kind": "x"}).status_code == 422
    api.MAX_AUDIO, old = 3, api.MAX_AUDIO
    assert s.send(sid).status_code == 413
    api.MAX_AUDIO = old
    assert files() == before


def test_consent():
    t, s, sid = pair(consent=False)
    before = files()
    assert s.send(sid).status_code == 403
    s("PATCH", f"/students/{sid}/join", json={"consent": True})
    sub = s.send(sid).json()["id"]
    t("POST", f"/teacher/submissions/{sub}", json=VERDICT)
    assert len(files() - before) == 1
    s("PATCH", f"/students/{sid}/join", json={"consent": False})
    assert files() == before
    assert len(s("GET", "/sync").json()["verdicts"]) == 1


def test_in_person():
    t, s, sid = pair(consent=False)
    assert t("POST", f"/teacher/students/{sid}/check", json={"meta": META, "verdict": VERDICT}).status_code == 200
    got = s("GET", "/sync").json()["verdicts"][0]
    assert got["audio"] is False
    assert [x["id"] for x in t("GET", "/teacher").json()["fresh"]] == [got["id"]]
    sub = {**META, "id": got["id"], "errors": 1, "notes": 1, "grade": 3, "passed": True}
    assert s("PUT", f"/students/{sid}", json={"rev": 1, "data": student(sid, submissions=[sub])}).status_code == 200
    assert t("GET", "/teacher").json()["fresh"] == []
    bad = {"meta": META, "verdict": {**VERDICT, "marks": {"<b>": 1}}}
    assert t("POST", f"/teacher/students/{sid}/check", json=bad).status_code == 422


@pytest.mark.parametrize("who", ["student", "teacher"])
def test_unlink(who):
    t, s, sid = pair()
    before = files()
    sub = s.send(sid).json()["id"]
    (s("DELETE", f"/students/{sid}/join") if who == "student" else t("DELETE", f"/teacher/students/{sid}"))
    assert files() == before and t("GET", "/teacher").json()["students"] == []
    assert t("GET", f"/submissions/{sub}/audio").status_code == 404


def test_change_teacher():
    t, s, sid = pair()
    t2 = User()
    s.send(sid)
    s("POST", f"/students/{sid}/join", json={"code": t2.teacher(), "consent": True})
    assert t("GET", "/teacher").json()["students"] == [] and t("GET", "/teacher").json()["inbox"] == []
    assert len(t2("GET", "/teacher").json()["requests"]) == 1


def test_delete_student():
    t, s, sid = pair()
    before = files()
    s.send(sid)
    assert s("DELETE", f"/students/{sid}").status_code == 200
    r = s("GET", "/sync").json()
    assert r["students"] == [] and r["deleted"] == [sid] and files() == before
    assert s("PUT", f"/students/{sid}", json={"rev": 1, "data": student(sid)}).status_code == 410
    assert t("GET", "/teacher").json()["students"] == []


def test_delete_account():
    t, s, sid = pair()
    before = files()
    s.send(sid)
    assert s("DELETE", "/me").status_code == 200
    assert s("GET", "/sync").status_code == 401 and files() == before and t("GET", "/teacher").json()["students"] == []
    t, s, sid = pair()
    s.send(sid)
    t("DELETE", "/me")
    assert files() == before and s("GET", "/sync").json()["links"] == []


BOT = {"x-bot": api.bot_secret()}


def web():
    api.POLL_SECONDS = 1
    r = http.post("/api/auth/web").json()
    return r, r["link"].split("login_")[1]


def poll(r):
    return http.post("/api/login/poll", json={"poll": r["poll"]})


def test_web_login():
    u = User("Али")
    r, start = web()
    assert poll(r).json() == {"waiting": True}
    assert http.post("/internal/login", json={"start": start}, headers=BOT).json() == {"number": r["number"]}
    ok = http.post("/internal/login/answer", json={"start": start, "tg_id": u.tg, "name": "Али", "yes": True}, headers=BOT)
    assert ok.status_code == 200
    got = poll(r).json()
    assert got["account"]["id"] == u.account["id"]
    u.use(got)
    assert u("GET", "/sync").status_code == 200
    # Оборвавшийся запрос не съедает вход, но подтвердить второй раз нельзя.
    assert poll(r).json()["account"]["id"] == u.account["id"]
    assert http.post("/internal/login/answer", json={"start": start, "tg_id": 1, "yes": True}, headers=BOT).status_code == 404


def test_web_login_new_person():
    r, start = web()
    http.post("/internal/login/answer", json={"start": start, "tg_id": 987654, "name": "Новый", "yes": True}, headers=BOT)
    assert poll(r).json()["account"]["name"] == "Новый"


def test_web_login_declined_and_expired():
    r, start = web()
    http.post("/internal/login/answer", json={"start": start}, headers=BOT)
    assert poll(r).json() == {"declined": True}
    r, start = web()
    with api.db() as d:
        d.execute("UPDATE logins SET expires=1")
    assert poll(r).status_code == 410
    assert http.post("/internal/login", json={"start": start}, headers=BOT).status_code == 404


def test_internal_is_closed():
    r, start = web()
    for h in ({}, {"x-bot": "bad"}):
        assert http.post("/internal/login", json={"start": start}, headers=h).status_code == 403
        assert http.post("/internal/login/answer", json={"start": start, "tg_id": 1, "yes": True}, headers=h).status_code == 403
    # Ключ из ссылки бота не даёт войти: ждать можно только по секрету сайта.
    assert http.post("/api/login/poll", json={"poll": start}).status_code == 410


def test_logout_others():
    u = User()
    old = u.token
    u.use(http.post("/api/auth/telegram", json={"initData": init_data(u.tg)}).json())
    assert u("POST", "/auth/logout-others").status_code == 200
    assert u("GET", "/sync").status_code == 200
    u.token = old
    assert u("GET", "/sync").status_code == 401


def test_groups():
    t, s, sid = pair()
    first = t("GET", "/teacher").json()["groups"][0]
    second = t("POST", "/groups", json={"name": "Вечер"}).json()["id"]
    assert [g["name"] for g in t("GET", "/teacher").json()["groups"]] == ["Моя группа", "Вечер"]
    assert s("POST", "/groups", json={"name": "x"}).status_code == 403
    # Перевод в другую группу и переход по второй ссылке не требуют нового подтверждения.
    assert t("PATCH", f"/teacher/students/{sid}", json={"group": second}).status_code == 200
    assert t("GET", "/teacher").json()["students"][0]["group"] == second
    assert s("GET", "/sync").json()["links"][0]["group"] == "Вечер"
    s("POST", f"/students/{sid}/join", json={"code": t.codes()[0], "consent": True})
    link = s("GET", "/sync").json()["links"][0]
    assert link["group"] == "Моя группа" and link["status"] == "active"
    assert t("DELETE", f"/groups/{first['id']}").status_code == 409
    assert t("DELETE", f"/groups/{second}").status_code == 200
    t("PATCH", f"/groups/{first['id']}", json={"name": "Утро"})
    old = t.codes()[0]
    t("POST", f"/groups/{first['id']}/link")
    assert t.codes()[0] != old and s("GET", f"/invites/{old}").status_code == 404
    assert t("GET", "/teacher").json()["students"][0]["data"]["id"] == sid
    x = User()
    x.teacher()
    for m, p, j in [("PATCH", "", {"name": "y"}), ("DELETE", "", None), ("POST", "/link", None)]:
        assert x(m, f"/groups/{first['id']}{p}", json=j).status_code == 404
    other = x("GET", "/teacher").json()["groups"][0]["id"]
    assert t("PATCH", f"/teacher/students/{sid}", json={"group": other}).status_code == 404


def test_migration(tmp_path):
    """База прежней версии: код учителя становится ссылкой его группы, связи сохраняются."""
    import sqlite3
    import subprocess
    import sys

    c = sqlite3.connect(tmp_path / "quran.db")
    c.executescript("""
      CREATE TABLE accounts (id TEXT PRIMARY KEY, tg_id INTEGER UNIQUE, name TEXT NOT NULL, role TEXT, teacher_code TEXT UNIQUE, created INTEGER NOT NULL);
      CREATE TABLE login_codes (hash TEXT PRIMARY KEY);
      CREATE TABLE students (id TEXT PRIMARY KEY, account TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, data TEXT, rev INTEGER NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE links (student TEXT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE, teacher TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, status TEXT NOT NULL, consent INTEGER, created INTEGER NOT NULL);
      INSERT INTO accounts VALUES ('t',1,'Устаз','teacher','ABC234',1),('s',2,'Ученик',NULL,NULL,1);
      INSERT INTO students VALUES ('student1','s','{}',1,1,0);
      INSERT INTO links VALUES ('student1','t','active',5,1);
    """)
    c.commit()
    c.close()
    env = {**os.environ, "API_DATA": str(tmp_path)}
    for _ in range(2):  # второй запуск ничего не меняет
        subprocess.run([sys.executable, "-c", "import api"], check=True, env=env, cwd=os.path.dirname(os.path.abspath(__file__)))
    c = sqlite3.connect(tmp_path / "quran.db")
    assert c.execute("SELECT g.code, g.teacher, l.status, l.consent FROM links l JOIN groups g ON g.id=l.grp").fetchall() == [("ABC234", "t", "active", 5)]
    assert c.execute("SELECT COUNT(*) FROM groups").fetchone() == (1,)


def test_purge():
    t, s, sid = pair()
    before = files()
    sub = s.send(sid).json()["id"]
    t("POST", f"/teacher/submissions/{sub}", json=VERDICT)
    waiting = s.send(sid).json()["id"]
    api.purge()
    assert len(files() - before) == 2
    with api.db() as d:
        d.execute("UPDATE submissions SET checked=checked-31*86400 WHERE id=?", (sub,))
        d.execute("UPDATE submissions SET created=created-61*86400 WHERE id=?", (waiting,))
    api.purge()
    assert files() == before
    r = s("GET", "/sync").json()
    assert len(r["verdicts"]) == 1 and r["waiting"] == []


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="нет ffmpeg")
def test_transcode(tmp_path):
    src, dst = str(tmp_path / "a"), str(tmp_path / "b")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-f", "lavfi", "-i", "sine=d=1", "-c:a", "libopus", "-f", "webm", src], check=True)
    real_transcode(src, dst)
    assert open(dst, "rb").read(8)[4:] == b"ftyp"
    bad = tmp_path / "c"
    bad.write_bytes(b"not audio")
    with pytest.raises(api.HTTPException):
        real_transcode(str(bad), str(tmp_path / "d"))


def test_doc_may_have_empty_name():
    u = User()
    u.add(name="")

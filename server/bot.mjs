// Телеграм-бот платформы: открывает приложение и напоминает распорядок дня.
// Без зависимостей, Node 18+. Работает на сервере «quran» службой quran-bot.
//
// Токен берётся только из окружения (BOT_TOKEN, файл /etc/quran/bot.env).
// В репозиторий и в логи токен не попадает.
//
// Вход на сайте: сайт даёт ссылку /start login_КЛЮЧ, человек подтверждает здесь (см. server/api.py).
//
// Кто нажал /start, тот получает напоминания; /stop отключает.
// Подписчики хранятся в DATA_DIR/subscribers.json.

import { createHmac } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL || "https://130-61-147-45.sslip.io";
const TZ = process.env.TZ_NAME || "Asia/Almaty";
const DATA_DIR = process.env.DATA_DIR || "/var/lib/quran-bot";
const API = `${process.env.TELEGRAM_API || "https://api.telegram.org"}/bot${TOKEN}`;

if (!TOKEN) {
  console.error("Нет BOT_TOKEN: положите токен скриптом scripts/set-bot-token.sh");
  process.exit(1);
}

// Распорядок по методике (см. РАСПОРЯДОК.md). Время по Алматы.
const SCHEDULE = [
  { at: "05:00", text: "Время сдать урок устазу. Если урок ещё не сдан, сдайте после фаджра." },
  // Кому личный план («Сегодня: джуз 1») шлёт quran-api, этого общего напоминания не получает.
  { at: "08:00", text: "Время недавнего и давнего: повторите и сдайте до 10:00.", revision: true },
  { at: "12:30", text: "Учите новый урок: шаги по порядку, всего 200 повторений." },
  { at: "18:30", text: "Подготовьте новый урок на завтра." },
  { at: "20:00", text: "Повторите давнее перед сном." },
];

const WELCOME =
  "Ассаляму алейкум!\n\n" +
  "Здесь платформа заучивания Корана: урок, недавнее, давнее, счётчик повторений и сдача.\n\n" +
  "Кнопка ниже открывает приложение. Я буду напоминать распорядок дня:\n" +
  SCHEDULE.map((s) => `${s.at} ${s.text}`).join("\n") +
  "\n\nОтключить напоминания: /stop. Включить снова: /start.";

// ---------- Telegram API ----------

async function call(method, body) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!json.ok) throw new Error(`${method}: ${json.description || res.status}`);
  return json.result;
}

const button = (url) => ({ inline_keyboard: [[{ text: "Открыть", web_app: { url } }]] });
const send = (chat_id, text, url = APP_URL) => call("sendMessage", { chat_id, text, reply_markup: button(url) });

// ---------- вход на сайте ----------

const INTERNAL = process.env.API_INTERNAL || "http://127.0.0.1:8091/internal";
const SECRET = createHmac("sha256", TOKEN).update("quran-internal").digest("hex");

/** Запрос к quran-api на этом же сервере; null, если ссылка устарела. */
async function internal(path, body) {
  const res = await fetch(INTERNAL + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-bot": SECRET },
    body: JSON.stringify(body),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`internal ${path}: ${res.status}`);
  return res.json();
}

/** Личные утренние напоминания шлёт quran-api: /stop и /start включают и выключают и их. */
const mute = (chat, muted) =>
  internal("/mute", { tg_id: Number(chat), muted }).catch((e) => console.error(`напоминания: ${e.message}`));

const EXPIRED = "Эта ссылка для входа устарела. Нажмите «Войти через Telegram» на сайте ещё раз.";

async function askLogin(chat, start) {
  const login = await internal("/login", { start });
  if (!login) return call("sendMessage", { chat_id: chat, text: EXPIRED });
  return call("sendMessage", {
    chat_id: chat,
    text:
      `Вход на сайт «Устаз-помощник». На сайте должно быть число ${login.number}.\n\n` +
      "Это вы входите? Если ссылку вам кто-то прислал, нажмите «Нет»: иначе он войдёт вместо вас.",
    reply_markup: {
      inline_keyboard: [[
        { text: "Да, это я", callback_data: `login:y:${start}` },
        { text: "Нет", callback_data: `login:n:${start}` },
      ]],
    },
  });
}

async function onButton(q) {
  const m = (q.data || "").match(/^login:([yn]):([\w-]{10,40})$/);
  if (!m || !q.message) return call("answerCallbackQuery", { callback_query_id: q.id });
  const yes = m[1] === "y";
  const done = await internal("/login/answer", { start: m[2], yes, tg_id: q.from.id, name: q.from.first_name || "" });
  await call("answerCallbackQuery", { callback_query_id: q.id });
  const text = !done ? EXPIRED : yes ? "Готово, вы вошли. Вернитесь на сайт." : "Вход отклонён.";
  await call("editMessageText", { chat_id: q.message.chat.id, message_id: q.message.message_id, text });
}

// ---------- подписчики ----------

const FILE = join(DATA_DIR, "subscribers.json");
/** chat_id -> { name, since, last: { "HH:MM": "YYYY-MM-DD" } } */
let subs = {};

async function load() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    subs = JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    subs = {};
  }
}

async function save() {
  const tmp = FILE + ".tmp";
  await writeFile(tmp, JSON.stringify(subs, null, 1));
  await rename(tmp, FILE);
}

// ---------- время по Алматы ----------

function nowLocal() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

// ---------- напоминания ----------

async function tick() {
  const { date, time } = nowLocal();
  // Окно 10 минут: если бот перезапускался в нужную минуту, напоминание всё равно уйдёт.
  const due = SCHEDULE.filter((s) => s.at <= time && minutes(time) - minutes(s.at) < 10);
  if (!due.length) return;
  let changed = false;
  let personal = new Set();
  if (due.some((s) => s.revision)) {
    try {
      personal = new Set((await internal("/personal", {})).ids.map(String));
    } catch (e) {
      console.error(`личные планы: ${e.message}`);
    }
  }
  for (const [chat, sub] of Object.entries(subs)) {
    for (const s of due) {
      if (sub.last?.[s.at] === date || (s.revision && personal.has(chat))) continue;
      try {
        await send(chat, s.text);
      } catch (e) {
        console.error(`напоминание ${chat}: ${e.message}`);
        // Пользователь заблокировал бота: убираем из рассылки.
        if (/blocked|deactivated|chat not found/i.test(e.message)) delete subs[chat];
      }
      if (subs[chat]) subs[chat].last = { ...subs[chat].last, [s.at]: date };
      changed = true;
    }
  }
  if (changed) await save();
}

const minutes = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

// ---------- входящие ----------

async function onMessage(msg) {
  const chat = String(msg.chat.id);
  const text = (msg.text || "").trim();
  const login = text.match(/^\/start login_([\w-]{10,40})$/)?.[1];
  if (login) {
    if (msg.chat.type === "private") await askLogin(chat, login);
  } else if (text.startsWith("/start")) {
    const { date } = nowLocal();
    // Сегодняшние прошедшие напоминания помечаем отправленными, чтобы не прислать всё сразу.
    const last = Object.fromEntries(SCHEDULE.map((s) => [s.at, date]));
    const { time } = nowLocal();
    for (const s of SCHEDULE) if (s.at > time) delete last[s.at];
    subs[chat] = { name: msg.from?.first_name || "", since: date, last };
    await save();
    await mute(chat, false);
    // Ссылка учителя: t.me/бот?start=join_КОД. Приложение откроется сразу на записи к нему.
    const join = text.match(/^\/start join_([A-Z0-9]{6,16})$/)?.[1];
    if (join) await send(chat, "Ассаляму алейкум! Учитель зовёт вас в группу. Откройте приложение кнопкой ниже.", `${APP_URL}/?join=${join}`);
    else await send(chat, WELCOME);
  } else if (text.startsWith("/stop")) {
    delete subs[chat];
    await save();
    await mute(chat, true);
    await call("sendMessage", { chat_id: chat, text: "Напоминания отключены. Включить снова: /start." });
  } else {
    await send(chat, "Откройте приложение кнопкой ниже.");
  }
}

async function poll() {
  let offset = 0;
  for (;;) {
    try {
      const updates = await call("getUpdates", { offset, timeout: 50, allowed_updates: ["message", "callback_query"] });
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.callback_query) await onButton(u.callback_query).catch((e) => console.error(`кнопка: ${e.message}`));
        if (u.message) await onMessage(u.message).catch((e) => console.error(`сообщение: ${e.message}`));
      }
    } catch (e) {
      console.error(`getUpdates: ${e.message}`);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// ---------- запуск ----------

await load();
const me = await call("getMe");
console.log(`бот @${me.username} запущен, подписчиков: ${Object.keys(subs).length}`);

// Кнопка меню рядом с полем ввода открывает приложение.
await call("setChatMenuButton", { menu_button: { type: "web_app", text: "Открыть", web_app: { url: APP_URL } } });
await call("setMyCommands", {
  commands: [
    { command: "start", description: "Открыть приложение и включить напоминания" },
    { command: "stop", description: "Отключить напоминания" },
  ],
});

setInterval(() => tick().catch((e) => console.error(`tick: ${e.message}`)), 30_000);
tick().catch(() => {});
poll();

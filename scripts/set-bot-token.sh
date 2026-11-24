#!/bin/bash
# Положить токен бота на сервер. Запускает сам владелец бота, в своём терминале.
# Токен вводится скрыто, идёт на сервер по SSH через stdin и не остаётся
# ни в истории команд, ни в репозитории, ни в переписке.
#
#   ./scripts/set-bot-token.sh
set -e

HOST=ubuntu@130.61.147.45
KEY="$HOME/.ssh/quran_oracle"

printf "Вставьте токен от BotFather (символы видно не будет) и нажмите Enter: "
read -rs TOKEN
echo
# Убрать пробелы и кавычки, которые попадают при копировании из Telegram.
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]"'"'"'`')"
# Если вставили всё сообщение BotFather целиком, взять из него только токен.
FOUND="$(printf '%s' "$TOKEN" | grep -oE '[0-9]{6,}:[A-Za-z0-9_-]{30,}' | head -1 || true)"
[ -n "$FOUND" ] && TOKEN="$FOUND"
if ! [[ "$TOKEN" =~ ^[0-9]+:[A-Za-z0-9_-]{30,}$ ]]; then
  echo "Это не похоже на токен BotFather (вида 123456789:ABC...). Ничего не изменено."
  exit 1
fi

printf 'BOT_TOKEN=%s\n' "$TOKEN" | ssh -i "$KEY" -o BatchMode=yes "$HOST" \
  'sudo mkdir -p /etc/quran && sudo install -m 600 -o root -g root /dev/stdin /etc/quran/bot.env && sudo systemctl restart quran-bot && sleep 3 && sudo journalctl -u quran-bot -n 3 --no-pager -o cat'
unset TOKEN
echo "Токен на сервере. Откройте бота в Telegram и нажмите /start."

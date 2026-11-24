#!/bin/bash
# Выложить новую версию на сервер Oracle «quran».
# Собирает приложение и заливает dist в /var/www/quran (nginx отдаёт как есть).
#
#   ./scripts/deploy.sh
#
# Адрес: https://130-61-147-45.sslip.io
# Вход на сервер: ssh -i ~/.ssh/quran_oracle ubuntu@130.61.147.45
set -e
cd "$(dirname "$0")/.."

HOST=ubuntu@130.61.147.45
KEY="$HOME/.ssh/quran_oracle"

npm run build
rsync -az --delete -e "ssh -i $KEY -o BatchMode=yes" dist/ "$HOST:/var/www/quran/"

# Бот: новый код и перезапуск (если токен уже положен).
rsync -az -e "ssh -i $KEY -o BatchMode=yes" server/bot.mjs "$HOST:/tmp/quran-bot.mjs"
ssh -i "$KEY" -o BatchMode=yes "$HOST" \
  'sudo install -m 644 /tmp/quran-bot.mjs /opt/quran-bot/bot.mjs && { [ -f /etc/quran/bot.env ] && sudo systemctl restart quran-bot || true; }'
echo "Готово: https://130-61-147-45.sslip.io"

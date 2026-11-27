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
rsync -az --checksum --delete --timeout=120 -e "ssh -i $KEY -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4" dist/ "$HOST:/var/www/quran/"

# Бот: новый код и перезапуск (если токен уже положен).
rsync -az -e "ssh -i $KEY -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4" server/bot.mjs "$HOST:/tmp/quran-bot.mjs"
ssh -i "$KEY" -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "$HOST" \
  'sudo install -m 644 /tmp/quran-bot.mjs /opt/quran-bot/bot.mjs && { [ -f /etc/quran/bot.env ] && sudo systemctl restart quran-bot || true; }'
# Распознавание чтения (ИИ): код сервиса и перезапуск. Установка с нуля описана в server/asr.py.
rsync -az -e "ssh -i $KEY -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4" server/asr.py "$HOST:/tmp/quran-asr.py"
ssh -i "$KEY" -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "$HOST" \
  'sudo install -m 644 /tmp/quran-asr.py /opt/quran-asr/asr.py && sudo systemctl restart quran-asr'
# Аккаунты, прогресс и сдачи. Первая установка: scripts/install-api.sh.
rsync -az -e "ssh -i $KEY -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4" server/api.py "$HOST:/tmp/quran-api.py"
ssh -i "$KEY" -o BatchMode=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=4 "$HOST" \
  'sudo install -m 644 /tmp/quran-api.py /opt/quran-api/api.py && sudo systemctl restart quran-api'
echo "Готово: https://130-61-147-45.sslip.io"

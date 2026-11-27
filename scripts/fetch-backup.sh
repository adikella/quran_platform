#!/bin/bash
# Забрать копии базы с сервера на этот компьютер: ~/quran-backups (не в репозиторий, там личные данные).
# Каждый день сам запускается на Mac после scripts/install-mac-backup.sh.
HOST=${QURAN_HOST:-ubuntu@130.61.147.45}
KEY="$HOME/.ssh/quran_oracle"
DIR=${QURAN_BACKUPS:-$HOME/quran-backups}
KEEP=60
umask 077
mkdir -p "$DIR"

ok=1
# После сна сеть появляется не сразу: пробуем несколько раз.
for wait in 0 30 120; do
  sleep "${QURAN_WAIT:-$wait}"
  rsync -az --rsync-path="sudo rsync" -e "ssh -i $KEY -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4" --timeout=120 "$HOST:/var/backups/quran/" "$DIR/" && ok=0 && break
done

newest=$(ls "$DIR" | grep -E '^quran-20[0-9-]{8}\.db\.gz$' | sort | tail -1)
[ -n "$newest" ] && ! gunzip -t "$DIR/$newest" && ok=1
# Хранятся последние 60 ежедневных копий. Если сервер пропал, старые не удаляются: новых нет.
if [ $ok = 0 ]; then
  ls "$DIR" | grep -E '^quran-20[0-9-]{8}\.db\.gz$' | sort -r | tail -n +$((KEEP + 1)) | while read -r f; do rm "$DIR/$f"; done
fi

# Копии нет больше двух дней: сказать об этом на экране.
age=$(( ($(date +%s) - $(stat -f %m "$DIR/${newest:-.}")) / 3600 ))
if [ -z "$newest" ] || [ $age -gt 48 ]; then
  osascript -e 'display notification "Копия базы не обновлялась больше двух дней. Напиши Claude." with title "Устаз-помощник"' || true
fi
echo "$(date '+%Y-%m-%d %H:%M') ok=$([ $ok = 0 ] && echo да || echo нет) последняя: ${newest:-нет}, часов назад: $age"
exit $ok

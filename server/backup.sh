#!/bin/bash
# Ночная копия базы (аккаунты, прогресс, оценки; без записей голоса). Хранится 14 дней в /var/backups/quran.
# Запускает таймер quran-backup.timer. На свой компьютер копии забирает scripts/fetch-backup.sh.
set -euo pipefail
umask 077
OUT=/var/backups/quran
mkdir -p "$OUT"
FILE="$OUT/quran-$(date +%F).db"
/usr/bin/python3 - "$FILE.tmp" <<'PY'
import sqlite3, sys
src = sqlite3.connect("/var/lib/quran-api/quran.db")
dst = sqlite3.connect(sys.argv[1])
src.backup(dst)
if dst.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
    sys.exit("копия повреждена")
PY
gzip -f "$FILE.tmp"
mv "$FILE.tmp.gz" "$FILE.gz"
find "$OUT" -name 'quran-*.db.gz' -mtime +14 -delete

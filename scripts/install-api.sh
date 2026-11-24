#!/bin/bash
# Поставить службу quran-api на сервер с нуля (один раз). Обновления потом идут через deploy.sh.
set -e
cd "$(dirname "$0")/.."
HOST=ubuntu@130.61.147.45
KEY="$HOME/.ssh/quran_oracle"

rsync -az -e "ssh -i $KEY -o BatchMode=yes" server/api.py server/backup.sh server/quran-api.service \
  server/quran-backup.service server/quran-backup.timer server/nginx-api.conf "$HOST:/tmp/quran-api-install/"
ssh -i "$KEY" -o BatchMode=yes "$HOST" 'set -e
cd /tmp/quran-api-install
id quran-api >/dev/null 2>&1 || sudo useradd --system --home /var/lib/quran-api --shell /usr/sbin/nologin quran-api
sudo install -d -m 755 /opt/quran-api
sudo install -d -m 700 -o quran-api -g quran-api /var/lib/quran-api
[ -x /opt/quran-api/venv/bin/uvicorn ] || { sudo python3 -m venv /opt/quran-api/venv && sudo /opt/quran-api/venv/bin/pip install -q fastapi==0.165.0 uvicorn==0.54.0 python-multipart; }
sudo install -m 644 api.py /opt/quran-api/api.py
sudo install -m 755 backup.sh /opt/quran-api/backup.sh
sudo install -m 644 quran-api.service quran-backup.service quran-backup.timer /etc/systemd/system/
sudo install -m 644 nginx-api.conf /etc/nginx/snippets/quran-api.conf
printf "%s\n" "limit_req_zone \$binary_remote_addr zone=api:5m rate=5r/s;" "limit_req_zone \$binary_remote_addr zone=apiauth:5m rate=60r/m;" | sudo tee /etc/nginx/conf.d/quran-api-zone.conf >/dev/null
SITE=$(grep -l quran-asr.conf /etc/nginx/sites-available/* | head -1)
grep -q quran-api.conf "$SITE" || sudo sed -i "s#^\( *\)include /etc/nginx/snippets/quran-asr.conf;#&\n\1include /etc/nginx/snippets/quran-api.conf;#" "$SITE"
sudo systemctl daemon-reload
sudo systemctl enable --now quran-api quran-backup.timer
sudo nginx -t && sudo systemctl reload nginx
rm -r /tmp/quran-api-install'
echo "Готово."

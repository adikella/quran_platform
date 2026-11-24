#!/bin/bash
# Забрать копии базы с сервера на этот компьютер: ~/quran-backups (не в репозиторий, там личные данные).
set -e
HOST=ubuntu@130.61.147.45
KEY="$HOME/.ssh/quran_oracle"
umask 077
mkdir -p "$HOME/quran-backups"
rsync -az --rsync-path="sudo rsync" -e "ssh -i $KEY -o BatchMode=yes" "$HOST:/var/backups/quran/" "$HOME/quran-backups/"
ls -lh "$HOME/quran-backups" | tail -3

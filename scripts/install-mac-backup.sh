#!/bin/bash
# Поставить на этот Mac ежедневную копию базы (10:00, а если Mac спал, то при пробуждении).
# Убрать: launchctl bootout gui/$(id -u)/quran.backup; rm ~/Library/LaunchAgents/quran.backup.plist
set -e
SCRIPT="$(cd "$(dirname "$0")" && pwd)/fetch-backup.sh"
PLIST="$HOME/Library/LaunchAgents/quran.backup.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/quran-backups"
cat > "$PLIST" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>quran.backup</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$SCRIPT</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>10</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/quran-backups/fetch.log</string>
  <key>StandardErrorPath</key><string>$HOME/quran-backups/fetch.log</string>
</dict></plist>
XML
plutil -lint "$PLIST"
launchctl bootout "gui/$(id -u)/quran.backup" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Готово: копия каждый день в 10:00, папка ~/quran-backups."

#!/bin/bash
# Installiert die Backup Station als Ubuntu-Anwendung für Doppelklick-Start.

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$HOME/.local/share/applications"
mkdir -p "$INSTALL_DIR"

cat > "$INSTALL_DIR/backup-station.desktop" <<EOF
[Desktop Entry]
Name=Backup Station
Comment=Starte die Backup Station
Exec=/bin/bash -c 'cd "$PROJECT_DIR" && ./start_backup_station.sh'
Icon=utilities-terminal
Path=$PROJECT_DIR
Terminal=false
Type=Application
Categories=Utility;
EOF

chmod +x "$PROJECT_DIR/start_backup_station.sh"
echo "Backup Station installiert. Du findest sie jetzt im App-Launcher oder kannst die Datei start_backup_station.sh direkt doppelklicken."
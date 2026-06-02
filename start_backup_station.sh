#!/bin/bash
# Startet die Backup Station im Projektordner.
# Doppelklick auf diese Datei sollte den Server starten und den Browser öffnen.

cd "$(dirname "$0")"

if [ -f .venv/bin/activate ]; then
  source .venv/bin/activate
fi

python -m uvicorn beschtepo:app --host 127.0.0.1 --port 8000 &
SERVER_PID=$!

sleep 1
xdg-open "http://127.0.0.1:8000"

wait "$SERVER_PID"

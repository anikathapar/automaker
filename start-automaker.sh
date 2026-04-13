#!/usr/bin/env bash
# Web app + API server (same as npm run dev / npm start)
cd "$(dirname "$0")"
exec node start-automaker.mjs "$@"

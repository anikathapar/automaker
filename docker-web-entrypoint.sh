#!/bin/sh
set -e
# Single-container web: static UI (nginx) + API on localhost (same task / same VM).

. /usr/local/bin/docker-entrypoint-setup.sh
automaker_container_setup

gosu automaker node /app/apps/server/dist/index.js &
i=0
while [ "$i" -lt 45 ]; do
    if curl -sf "http://127.0.0.1:3008/api/health" >/dev/null 2>&1; then
        break
    fi
    i=$((i + 1))
    sleep 1
done
if ! curl -sf "http://127.0.0.1:3008/api/health" >/dev/null 2>&1; then
    echo "automaker: API failed health check on port 3008" >&2
    exit 1
fi

exec nginx -g "daemon off;"

#!/usr/bin/env bash
# Starts a user-space PostgreSQL (binaries bundled by @embedded-postgres/linux-x64).
# No root/Docker needed. Data lives in .pgdata. Matches DATABASE_URL in .env.example.
set -euo pipefail
cd "$(dirname "$0")/.."

PGBIN="node_modules/@embedded-postgres/linux-x64/native/bin"
PGDATA=".pgdata"
PORT=5433

export LD_LIBRARY_PATH="$PWD/node_modules/@embedded-postgres/linux-x64/native/lib:${LD_LIBRARY_PATH:-}"

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "Initializing PostgreSQL cluster in $PGDATA ..."
  PWFILE=$(mktemp)
  echo "pnl" > "$PWFILE"
  "$PGBIN/initdb" -D "$PGDATA" -U pnl --pwfile="$PWFILE" -A md5 -E UTF8 >/dev/null
  rm -f "$PWFILE"
fi

case "${1:-start}" in
  start)
    "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PORT -k /tmp" -l .pgdata/postgres.log start
    echo "PostgreSQL ready on postgresql://pnl:pnl@localhost:$PORT/postgres"
    ;;
  stop)
    "$PGBIN/pg_ctl" -D "$PGDATA" stop
    ;;
  status)
    "$PGBIN/pg_ctl" -D "$PGDATA" status
    ;;
  *)
    echo "usage: $0 [start|stop|status]"; exit 1;;
esac

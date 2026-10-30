#!/usr/bin/env bash
# Prova la migrazione su un Postgres locale (serve PostgreSQL >= 15 con pgcrypto).
# Uso: PGHOST=... PGPORT=... PGUSER=postgres ./supabase/tests/run.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
SQL_DB="random_targa_sql_$$"
STORE_DB="random_targa_store_$$"
trap 'dropdb --if-exists "$SQL_DB"; dropdb --if-exists "$STORE_DB"' EXIT

setup() {
  createdb "$1"
  psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$DIR/stub-supabase.sql"
  for f in "$DIR"/../migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 -d "$1" -f "$f"; done
}

# Scenari SQL (regole, permessi, catena di impronte).
setup "$SQL_DB"
psql -q -v ON_ERROR_STOP=1 -d "$SQL_DB" -f "$DIR/registro.test.sql"

# Client JavaScript (js/store-supabase.js) su un database pulito.
setup "$STORE_DB"
PGDATABASE="$STORE_DB" node --test "$DIR/store-supabase.test.js"

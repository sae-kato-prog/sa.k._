#!/bin/bash
# TalkNest (gadget_talknest_kato) backup script
# Usage: ./backup.sh
set -euo pipefail
cd "$(dirname "$0")"
TS=$(date +%Y%m%d_%H%M%S)
mkdir -p backups
export $(grep -v '^#' .env | xargs)
pg_dump "$DATABASE_URL" > "backups/talknest_kato_${TS}.sql"
echo "Backup written to backups/talknest_kato_${TS}.sql"

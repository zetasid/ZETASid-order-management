#!/bin/sh
# Run with: sh deploy/stack.sh install|update
set -eu
umask 077
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT"

dc() {
  # Never print expanded config: it includes secrets.
  if [ -f "${ENV_FILE:-.env}" ]; then
    docker compose --env-file "${ENV_FILE:-.env}" -f docker-compose.yml "$@"
  else
    docker compose -f docker-compose.yml "$@"
  fi
}

case "${1:-}" in
  install)
    dc config --quiet
    dc build --pull
    dc up -d --wait --wait-timeout 180
    ;;
  update)
    dc config --quiet
    # Build before stopping the running app. A failed build leaves it running.
    dc build --pull
    dc up -d --wait database
    dc stop web api
    # Back up after writers are stopped. A failure leaves the app in maintenance.
    mkdir -p backups
    BACKUP="backups/zetas-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
    if ! dc exec -T database sh -c 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$BACKUP"; then
      rm -f "$BACKUP"
      printf '%s\n' "Backup failed; application remains stopped. No migration was run." >&2
      exit 1
    fi
    # Always execute a fresh migration task, even when its image is unchanged.
    if ! dc run --rm --no-deps migrate; then
      printf '%s\n' "Migration failed; application remains stopped. Keep the database volume and backup." >&2
      exit 1
    fi
    dc up -d --wait --wait-timeout 180 api web
    printf 'Backup saved privately at %s. Copy it off-host.\n' "$BACKUP"
    ;;
  *)
    printf '%s\n' "Usage: sh deploy/stack.sh install|update" >&2
    exit 2
    ;;
esac
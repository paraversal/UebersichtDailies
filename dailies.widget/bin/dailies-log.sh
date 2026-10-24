#!/bin/bash
# Append one tap event to this machine's Dailies log.
# usage: dailies-log.sh <habit-id> <YYYY-MM-DD> <0|1|2> [timestamp-ms]
#
# Append-only on purpose: a single short write needs no read-modify-write, so
# two screens (or a double tap) can never corrupt the file. Habit ids are
# restricted to [a-z0-9_-], so nothing needs JSON escaping.
set -eu

habit="${1:-}"; day="${2:-}"; value="${3:-}"; ts="${4:-$(date +%s)000}"

[[ "$habit" =~ ^[a-z0-9_-]+$ ]]        || { echo "bad habit id" >&2; exit 1; }
[[ "$day"   =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo "bad date" >&2; exit 1; }
[[ "$value" =~ ^[012]$ ]]              || { echo "bad value" >&2; exit 1; }
[[ "$ts"    =~ ^[0-9]+$ ]]             || { echo "bad timestamp" >&2; exit 1; }

data_dir="${DAILIES_DATA_DIR:-$HOME/Library/Application Support/Dailies}"
mkdir -p "$data_dir"

# One file per machine, so syncing the folder (iCloud, Dropbox) never conflicts.
host="$(hostname -s | tr -c 'A-Za-z0-9\n_-' '-')"
printf '{"t":%s,"h":"%s","d":"%s","v":%s}\n' "$ts" "$habit" "$day" "$value" >> "$data_dir/log-$host.jsonl"

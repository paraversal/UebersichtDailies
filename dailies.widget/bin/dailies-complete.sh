#!/bin/bash
# Append a "calendar event completed / not completed" mark to this machine's Dailies log.
# usage: dailies-complete.sh <calendar-id> <event-id> <0|1> [timestamp-ms]
#
# Same append-only log as habit taps (dailies-log.sh); the habit replay ignores
# these lines and the widget replays them separately. Both ids are restricted
# (calendar id [a-z0-9_-], event id lowercase hex), so nothing needs JSON escaping.
set -eu

cal="${1:-}"; event="${2:-}"; value="${3:-}"; ts="${4:-$(date +%s)000}"

[[ "$cal"   =~ ^[a-z0-9_-]+$ ]]    || { echo "bad calendar id" >&2; exit 1; }
[[ "$event" =~ ^[0-9a-f]{8,32}$ ]] || { echo "bad event id" >&2; exit 1; }
[[ "$value" =~ ^[01]$ ]]           || { echo "bad value" >&2; exit 1; }
[[ "$ts"    =~ ^[0-9]+$ ]]         || { echo "bad timestamp" >&2; exit 1; }

data_dir="${DAILIES_DATA_DIR:-$HOME/Library/Application Support/Dailies}"
mkdir -p "$data_dir"

host="$(hostname -s | tr -c 'A-Za-z0-9\n_-' '-')"
printf '{"t":%s,"cal":"%s","e":"%s","v":%s}\n' "$ts" "$cal" "$event" "$value" >> "$data_dir/log-$host.jsonl"

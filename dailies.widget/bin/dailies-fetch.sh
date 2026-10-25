#!/bin/bash
# Download one calendar feed into the Dailies cache.
# usage: dailies-fetch.sh <calendar-id> <max-age-minutes> [force]   (feed URL on stdin)
#
# `force` (the refresh button) skips the freshness and back-off checks below.
#
# The URL is read from stdin and handed to curl via `-K -`, so the secret token
# in an iCloud subscription link never shows up in `ps`. A fresh cache is left
# alone, failures are remembered in cal-<id>.err (and retried at most every 5
# minutes), and the old cache is kept when a download fails. The cache is
# replaced atomically, so a reader never sees a half-written file.
set -u

id="${1:-}"; max_age="${2:-}"; force="${3:-}"
[[ "$id" =~ ^[a-z0-9_-]+$ ]] || { echo "bad calendar id" >&2; exit 1; }
[[ "$max_age" =~ ^[0-9]+$ ]] || { echo "bad max age" >&2; exit 1; }
[ -z "$force" ] || [ "$force" = force ] || { echo "bad option" >&2; exit 1; }

IFS= read -r url || true
url="${url%$'\r'}"
case "$url" in
  webcal://*|webcals://*) url="https://${url#*://}" ;;
esac
[[ "$url" =~ ^https?://[^[:space:]\"\'\\]+$ ]] || { echo "bad calendar url" >&2; exit 1; }

data_dir="${DAILIES_DATA_DIR:-$HOME/Library/Application Support/Dailies}"
cache="$data_dir/cache"
mkdir -p "$cache"
ics="$cache/cal-$id.ics"; err="$cache/cal-$id.err"
attempt="$cache/cal-$id.attempt"; lock="$cache/.lock-$id"

if [ "$force" != force ]; then
  # Still fresh? Then nothing to do. (A max age of 0 always refreshes.)
  if [ "$max_age" -gt 0 ] && [ -f "$ics" ] && [ -z "$(find "$ics" -mmin +"$max_age" 2>/dev/null)" ]; then exit 0; fi
  # Recently tried and failed? Back off.
  if [ -f "$attempt" ] && [ -z "$(find "$attempt" -mmin +5 2>/dev/null)" ]; then exit 0; fi
fi

# Several screens run this widget; only one should download at a time.
if ! mkdir "$lock" 2>/dev/null; then
  if [ -n "$(find "$lock" -maxdepth 0 -mmin +2 2>/dev/null)" ]; then
    rmdir "$lock" 2>/dev/null && mkdir "$lock" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
tmp="$(mktemp "$cache/.tmp-$id.XXXXXX")"
trap 'rm -f "$tmp"; rmdir "$lock" 2>/dev/null' EXIT

touch "$attempt"
if msg="$(printf 'url = "%s"\n' "$url" | curl -K - --fail --silent --show-error --location \
    --max-time 25 --max-filesize 30000000 --user-agent "Dailies/1" --output "$tmp" 2>&1)"; then
  if head -c 4096 "$tmp" | grep -q 'BEGIN:VCALENDAR'; then
    mv "$tmp" "$ics"
    rm -f "$err"
  else
    echo "the link did not return an iCalendar feed" > "$err"
  fi
else
  # Keep the message short and never echo the (secret) URL back.
  printf '%s' "$msg" | tr '\n' ' ' | sed -E 's#https?://[^[:space:]]+#<url>#g' | head -c 300 > "$err"
fi
exit 0

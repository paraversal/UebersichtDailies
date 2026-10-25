#!/bin/bash
# Print every cached calendar feed, each behind a marker line, plus any fetch
# errors. Parsed by parseCalendarOutput in lib/ics.js.
data_dir="${DAILIES_DATA_DIR:-$HOME/Library/Application Support/Dailies}"
cache="$data_dir/cache"

for f in "$cache"/cal-*.ics; do
  [ -f "$f" ] || continue
  id="$(basename "$f" .ics)"; id="${id#cal-}"
  echo "---DAILIES-CAL id=$id mtime=$(stat -f %m "$f")---"
  cat "$f"
  echo
done

for f in "$cache"/cal-*.err; do
  [ -f "$f" ] || continue
  id="$(basename "$f" .err)"; id="${id#cal-}"
  echo "---DAILIES-CALERR id=$id---"
  head -c 300 "$f" | tr '\r\n' '  '
  echo
done
exit 0

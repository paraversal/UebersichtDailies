#!/bin/bash
# Print the widget's config, a marker line, then every machine's log.
# Falls back to config.example.json until the user creates config.json.
widget_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
data_dir="${DAILIES_DATA_DIR:-$HOME/Library/Application Support/Dailies}"

if [ -f "$widget_dir/config.json" ]; then
  cat "$widget_dir/config.json"
else
  cat "$widget_dir/config.example.json"
fi

echo
echo "---DAILIES-LOG---"
for f in "$data_dir"/log-*.jsonl; do
  [ -f "$f" ] && cat "$f"
done
exit 0

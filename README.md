# UebersichtDailies

Übersicht widget for tracking daily habits: a grid of dots, one row per habit, one column per day. Click a dot to cycle **empty → done → skipped → empty**.

## Install

Symlink the widget folder into Übersicht's widgets directory:

```bash
ln -s "$PWD/dailies.widget" "$HOME/Library/Application Support/Übersicht/widgets/dailies.widget"
cp dailies.widget/config.example.json dailies.widget/config.json
```

Edit `dailies.widget/config.json`; Übersicht reloads the widget when it changes. Until `config.json` exists the widget falls back to `config.example.json`. Mistakes in the config are shown on the card, not as a blank widget.

## Config

| key | default | |
|---|---|---|
| `n_col` | `14` | days shown, 1–60 (older data is kept, just not shown) |
| `show_success_animation` | `true` | pop + ring when a dot becomes done |
| `location` | `"bottom_left"` | `top_left`, `top_right`, `bottom_left`, `bottom_right` |
| `margin` | `20` | px from the screen edge |
| `day_starts_at` | `"00:00"` | e.g. `"04:00"` makes 02:30 still count as the previous day |
| `week_starts` | `"monday"` | `monday` or `sunday`; a small gap is drawn before each new week |
| `habits` | required | strings, or `{ "id", "name", "color" }` (see Colors) |

A habit's `id` (default: its name, lowercased and hyphenated) is the key its history is stored under. If you rename a habit and want to keep its history, give it an explicit `id` equal to the old one.

## Colors

Leave `color` out and each habit gets its own color automatically. The hue comes from the habit's `id`, so it never changes between reloads, while lightness and chroma are shared by all habits (OKLCH), so any set of habits looks like one palette. Hues that land too close together are nudged apart. Set `"color": "#7aa2f7"` (any CSS color) on a habit to override it.

## Where data lives

Taps are appended as one JSON line each to
`~/Library/Application Support/Dailies/log-<hostname>.jsonl`:

```json
{"t":1761350000000,"h":"go-to-sleep-on-time","d":"2026-10-25","v":1}
```

The widget replays all `log-*.jsonl` files on load (latest event per habit and day wins) and re-reads them every 5 seconds, so multiple screens stay in sync. It is deliberately **outside** the widget folder, because Übersicht reloads a widget when files inside the widgets directory change. To sync between Macs, set `DAILIES_DATA_DIR` or symlink the folder into iCloud Drive or Dropbox. Each machine writes its own file, so there are no sync conflicts.

## Development

```bash
node --test test/core.test.js
```

Logic lives in `dailies.widget/lib/core.js` (pure, tested); `index.jsx` is rendering only; `bin/dailies-log.sh` and `bin/dailies-read.sh` are the only code that touches the disk.

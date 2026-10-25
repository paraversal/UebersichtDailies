import { React, run } from 'uebersicht'
import core from './lib/core.js'
import ics from './lib/ics.js'
import sync from './lib/calendar-sync.js'

// Übersicht runs commands with the *widgets root* as cwd, so find our bin/ folder
// by the script's own name. That works whatever the widget folder or symlink is called.
const LOCATE =
  'shopt -s nullglob; set -- ./*/bin/dailies-read.sh ./*/*/bin/dailies-read.sh; ' +
  '[ -n "$1" ] || { echo "dailies: bin/dailies-read.sh not found under the widgets folder" >&2; exit 1; }; ' +
  's=$(dirname "$1")'

export const command = `${LOCATE}; bash "$s/dailies-read.sh"`
export const refreshFrequency = 5000 // re-reads the log, so other screens/machines show up

// Full-screen, click-through layer; the card positions itself inside it.
export const className = `
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
`

// Calendar feeds are downloaded and cached outside the 5s poll (see lib/calendar-sync.js).
// The config is read once here; editing it reloads the widget, which runs init again.
export const init = (dispatch) => {
  if (window.__dailiesSync) window.__dailiesSync.stop()
  run(command)
    .then((output) => {
      const { config } = core.parseReadOutput(output)
      if (!config.calendars.length) return
      window.__dailiesSync = sync.startCalendarSync({
        run,
        dispatch,
        locate: LOCATE,
        calendars: config.calendars,
        refreshMinutes: config.calendar_refresh_minutes,
      })
    })
    .catch(() => {})
}

const initial = core.normalizeConfig({ habits: [] })

export const initialState = {
  config: initial.config,
  errors: [],
  values: {},
  pending: {},
  pop: null,
  loaded: false,
  fetchError: null,
  calendarData: {},
  calendarVersion: 0,
  refreshing: false,
  completions: {},
  pendingDone: {},
}

export const updateState = (event, prev) => {
  switch (event.type) {
    case 'UB/COMMAND_RAN': {
      if (event.error) return { ...prev, fetchError: String(event.error) }
      const { config, errors, values, completions } = core.parseReadOutput(event.output)
      const now = Date.now()
      const pending = core.prunePending(prev.pending, values, now)
      const pendingDone = core.prunePendingDone(prev.pendingDone, completions, now)
      return { ...prev, config, errors, values, pending, completions, pendingDone, loaded: true, fetchError: null }
    }
    case 'DAILIES/TAP': {
      const key = core.cellKey(event.habit, event.date)
      return {
        ...prev,
        pending: { ...prev.pending, [key]: { value: event.value, t: event.t } },
        pop: event.value === core.DONE ? key : null,
      }
    }
    case 'DAILIES/CALENDARS':
      return { ...prev, calendarData: ics.parseCalendarOutput(event.output), calendarVersion: prev.calendarVersion + 1 }
    case 'DAILIES/DONE': {
      const key = core.doneKey(event.cal, event.id)
      return { ...prev, pendingDone: { ...prev.pendingDone, [key]: { value: event.value, t: event.t } } }
    }
    case 'DAILIES/REFRESHING':
      return { ...prev, refreshing: event.busy }
    default:
      return prev
  }
}

// Expanding recurring events is the costly part; redo it only when the feeds
// or the visible window change, not on every 5s refresh.
let memo = { key: null, value: null }
const eventsByCalendar = (state, from, to) => {
  const key = `${state.calendarVersion}|${from}|${to}`
  if (memo.key === key) return memo.value
  const value = {}
  for (const c of state.config.calendars) {
    const data = state.calendarData[c.id]
    value[c.id] = data ? ics.expandEvents(data.events, from, to) : {}
  }
  memo = { key, value }
  return value
}

// Indexed by core.weekdayIndex, so the letters follow config.week_starts.
const WEEKDAY_LETTERS = {
  monday: ['M', 'T', 'W', 'T', 'F', 'S', 'S'],
  sunday: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
}
const WEEK_GAP = 8
const CELL = 26
const BUBBLE_MAX_LINES = 6

const anchor = ({ location, margin }) => {
  const [v, h] = location.split('_')
  return { position: 'absolute', [v]: margin, [h]: margin }
}

const css = `
.dailies-card {
  --fg: rgba(255,255,255,.88);
  --muted: rgba(255,255,255,.45);
  --empty: rgba(255,255,255,.14);
  --skip: rgba(255,255,255,.34);
  --bg: rgba(28,28,32,.55);
  --tip-bg: rgba(38,38,44,.92);
  --edge: rgba(255,255,255,.10);
  --today-bg: rgba(255,255,255,.075);
  --today-edge: rgba(255,255,255,.07);
  --l: .80; /* shared lightness + chroma for auto habit and calendar colors */
  --chroma: .13;
  font: 12px/1.2 -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--edge);
  margin-bottom: 15px;
  border-radius: 18px;
  padding: 14px 16px;
  backdrop-filter: blur(28px) saturate(160%);
  -webkit-backdrop-filter: blur(28px) saturate(160%);
  box-shadow: 0 8px 30px rgba(0,0,0,.25);
  pointer-events: auto;
  user-select: none;
  -webkit-user-select: none;
}
@media (prefers-color-scheme: light) {
  .dailies-card {
    --fg: rgba(0,0,0,.82);
    --muted: rgba(0,0,0,.42);
    --empty: rgba(0,0,0,.10);
    --skip: rgba(0,0,0,.28);
    --bg: rgba(255,255,255,.60);
    --tip-bg: rgba(255,255,255,.94);
    --edge: rgba(0,0,0,.08);
    --today-bg: rgba(0,0,0,.055);
    --today-edge: rgba(0,0,0,.05);
    --l: .68;
  }
}
.dailies-grid { display: grid; align-items: center; position: relative; }
.dailies-label {
  padding-right: 14px; max-width: 170px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dailies-label.cal { color: var(--muted); }
.dailies-head { text-align: center; color: var(--muted); font-size: 10px; line-height: 1.25; padding-bottom: 4px; }
.dailies-head b { display: block; font-weight: 600; font-size: 11px; }
.dailies-head.today { color: var(--fg); }
.dailies-head.week { padding-left: ${WEEK_GAP}px; }
.dailies-cell.week, .dailies-cal-cell.week { justify-self: end; }
.dailies-streak { padding-left: 10px; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.dailies-sep { grid-column: 1 / -1; height: 1px; margin: 6px 0; background: var(--edge); }

.dailies-cell, .dailies-cal-cell, .dailies-line { --c: oklch(var(--l) var(--chroma) var(--h, 160)); }
.dailies-cell {
  all: unset; box-sizing: border-box; width: ${CELL}px; height: ${CELL}px;
  display: grid; place-items: center; cursor: pointer;
}
.dailies-dot {
  width: 14px; height: 14px; border-radius: 50%;
  background: var(--empty);
  transition: background-color .35s ease, transform .15s ease;
}
.dailies-cell:hover .dailies-dot { transform: scale(1.15); }
.dailies-cell:active .dailies-dot { transform: scale(.88); }
.dailies-cell.s2 .dailies-dot { background: var(--skip); transform: scale(.55); }
.dailies-cell.s1 .dailies-dot { background: var(--c); }
.dailies-cell.s1.pop .dailies-dot { animation: dailies-pop .5s cubic-bezier(.2,.9,.3,1.4); }
.dailies-cell.s1.pop::after {
  content: ''; position: absolute; width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--c); pointer-events: none;
  animation: dailies-ring .6s ease-out forwards;
}
.dailies-cell { position: relative; }
.dailies-cell.future { cursor: default; pointer-events: none; }
.dailies-cell.future .dailies-dot { opacity: .45; transform: scale(.8); }

/* soft pill behind today's column, from the date header down to the last habit */
.dailies-today {
  position: absolute; z-index: -1; pointer-events: none;
  top: -3px; bottom: -3px; left: 1px; right: 1px; border-radius: ${CELL / 2}px;
  background: var(--today-bg); box-shadow: inset 0 0 0 1px var(--today-edge);
  animation: dailies-fade .4s ease backwards;
}
.dailies-today.week { left: ${WEEK_GAP + 1}px; }

/* refresh button: only there while the card is hovered (or while refreshing) */
.dailies-refresh {
  /* z-index: the grid comes later and would otherwise paint (and take clicks) over the lower half */
  all: unset; box-sizing: border-box; position: absolute; z-index: 25; top: 3px; left: 4px;
  width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center;
  color: var(--muted); cursor: pointer; opacity: 0;
  transition: opacity .2s ease, background-color .15s ease, color .15s ease;
}
.dailies-card:hover .dailies-refresh { opacity: 1; }
.dailies-refresh:hover { background: var(--empty); color: var(--fg); }
.dailies-refresh:active svg { transform: scale(.88); }
.dailies-refresh.busy { opacity: 1; cursor: default; }
.dailies-refresh.busy svg { animation: dailies-spin .8s linear infinite; }

/* calendar rows: a smaller dot than the habit dots, so the two kinds never look alike */
.dailies-cal-cell {
  position: relative; box-sizing: border-box; width: ${CELL}px; height: ${CELL}px;
  display: grid; place-items: center;
}
.dailies-cal-cell:hover { z-index: 20; }
.dailies-evdot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
.dailies-evcheck { display: grid; place-items: center; color: var(--c); }
.dailies-cal-cell.past .dailies-evdot, .dailies-cal-cell.past .dailies-evcheck { opacity: .5; }
.dailies-cal-cell.has-events { cursor: pointer; }
.dailies-cal-cell.has-events:hover .dailies-evdot { transform: scale(1.25); }
.dailies-evdot { transition: transform .15s ease; }
.dailies-count {
  position: absolute; top: 1px; right: 2px;
  font-size: 8px; font-weight: 600; line-height: 1; color: var(--muted);
  font-variant-numeric: tabular-nums;
}

/* tooltip on hover */
.dailies-tip, .dailies-bubble {
  position: absolute; width: max-content; max-width: 240px; box-sizing: border-box;
  padding: 6px 9px; border-radius: 10px; font-size: 11px; line-height: 1.3;
  background: var(--tip-bg); border: 1px solid var(--edge);
  backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
  box-shadow: 0 6px 20px rgba(0,0,0,.28);
  text-align: left;
}
.dailies-tip { pointer-events: none; }
.dailies-bubble { pointer-events: auto; }
.dailies-tip { z-index: 30; opacity: 0; transition: opacity .12s ease; }
.dailies-cal-cell:hover .dailies-tip { opacity: 1; pointer-events: auto; }
/* a bridge over the 2px gap, so the pointer can travel from the dot into the tooltip */
.dailies-tip::before { content: ''; position: absolute; left: 0; right: 0; height: 6px; }
.dailies-tip.up::before { top: 100%; }
.dailies-tip.down::before { bottom: 100%; }
.dailies-tip.up { bottom: calc(100% + 2px); }
.dailies-tip.down { top: calc(100% + 2px); }
.dailies-tip.l, .dailies-bubble.l { left: 0; }
.dailies-tip.r, .dailies-bubble.r { right: 0; }
.dailies-line { display: flex; gap: 7px; align-items: baseline; cursor: pointer; border-radius: 6px; margin: 0 -4px; padding: 1px 4px; }
.dailies-line + .dailies-line { margin-top: 2px; }
.dailies-line:hover { background: var(--empty); }
/* an empty ring, like a checkbox; filled with a tick once the event is completed */
.dailies-line i {
  flex: none; box-sizing: border-box; width: 11px; height: 11px; border-radius: 50%;
  border: 1.5px solid var(--c); display: grid; place-items: center; color: var(--tip-bg);
  transform: translateY(1px); transition: background-color .2s ease;
}
.dailies-line.done i { background: var(--c); }
.dailies-line.done span { color: var(--muted); text-decoration: line-through; text-decoration-color: var(--muted); }
.dailies-line.done em { opacity: .7; }
.dailies-line em { font-style: normal; color: var(--muted); font-variant-numeric: tabular-nums; }
.dailies-line span { overflow-wrap: anywhere; }

/* speech bubble for today's events, outside the card, with a tail pointing at today's column */
.dailies-bubble { z-index: 5; animation: dailies-fade .3s ease backwards; }
.dailies-bubble.up { bottom: calc(100% + 24px); }
.dailies-bubble.down { top: calc(100% + 24px); }
.dailies-bubble::after {
  content: ''; position: absolute; width: 8px; height: 8px;
  background: var(--tip-bg); border: 1px solid var(--edge); transform: rotate(45deg);
}
.dailies-bubble.up::after { bottom: -5px; border-top: 0; border-left: 0; }
.dailies-bubble.down::after { top: -5px; border-bottom: 0; border-right: 0; }
.dailies-bubble.l::after { left: 9px; }
.dailies-bubble.r::after { right: 9px; }
.dailies-grid:has(.dailies-cal-cell:hover) .dailies-bubble { opacity: 0; pointer-events: none; transition: opacity .1s; }
.dailies-more { color: var(--muted); margin-top: 3px; }

@keyframes dailies-pop { 0% { transform: scale(.6); } 60% { transform: scale(1.35); } 100% { transform: scale(1); } }
@keyframes dailies-ring { from { transform: scale(1); opacity: .8; } to { transform: scale(2.4); opacity: 0; } }
@keyframes dailies-spin { to { transform: rotate(360deg); } }
@keyframes dailies-fade { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
  .dailies-dot, .dailies-tip { transition: none; }
  .dailies-cell.s1.pop .dailies-dot, .dailies-cell.s1.pop::after, .dailies-bubble { animation: none; }
  .dailies-refresh.busy svg { animation: none; }
  .dailies-today { animation: none; }
  .dailies-refresh.busy { color: var(--fg); }
}
.dailies-errors { color: #ff8a80; font-size: 11px; max-width: 320px; margin-bottom: 8px; }
.dailies-errors div + div { margin-top: 3px; }
.dailies-errors.beside-refresh { padding-left: 14px; }
`

const Check = ({ size, width }) => (
  <svg viewBox="0 0 10 10" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.8 5.4l2.2 2.2L8.3 2.6" />
  </svg>
)

const colorStyle = (item) => (item.color ? { '--c': item.color } : { '--h': item.hue })

export const render = (state, dispatch) => {
  const { config, errors, values, pending, pop, loaded, fetchError, calendarData, refreshing, completions, pendingDone } = state
  const now = new Date()
  const today = core.dayKey(now, config.day_starts_at)
  const days = core.dayRange(today, config.n_col, config.n_future)
  const todayIdx = config.n_col - 1
  const up = config.location.startsWith('bottom') // tooltips open away from the screen edge
  const vertical = up ? 'up' : 'down'

  const calEvents = config.calendars.length ? eventsByCalendar(state, days[0], days[days.length - 1]) : {}
  const calErrors = config.calendars
    .filter((c) => calendarData[c.id] && calendarData[c.id].error)
    .map((c) => `calendar "${c.name || calendarData[c.id].name || c.id}": ${calendarData[c.id].error}`)
  const messages = [...(fetchError ? [fetchError] : []), ...errors, ...calErrors]

  const tap = (habit, date) => {
    const value = core.nextValue(core.effectiveValue(values, pending, habit.id, date))
    const t = Date.now()
    dispatch({ type: 'DAILIES/TAP', habit: habit.id, date, value, t })
    run(`${LOCATE}; bash "$s/dailies-log.sh" ${habit.id} ${date} ${value} ${t}`)
  }

  // A small gap before each new week (not before the first visible column).
  const weekStart = (d, i) => i > 0 && core.weekdayIndex(d, config.week_starts) === 0
  const grid = {
    gridTemplateColumns: `auto ${days.map((d, i) => (weekStart(d, i) ? CELL + WEEK_GAP : CELL) + 'px').join(' ')} auto`,
  }
  // Tooltips grow toward the middle of the card so they don't run off its edge.
  const side = (i) => (i + 1 > days.length / 2 ? 'r' : 'l')

  const calLabel = (c) => c.name || (calendarData[c.id] && calendarData[c.id].name) || ''
  const rowCount = 1 + config.calendars.length + (config.calendars.length ? 1 : 0) + config.habits.length

  const isDone = (c, e) => core.effectiveDone(completions, pendingDone, c.id, e.id) === 1

  // Mark events completed (or open again). Same optimistic-then-log flow as habit taps.
  const setDone = (c, changes) => {
    if (!changes.length) return
    const t = Date.now()
    changes.forEach(({ e, value }) => dispatch({ type: 'DAILIES/DONE', cal: c.id, id: e.id, value, t }))
    run(`${LOCATE}; ` + changes.map(({ e, value }) => `bash "$s/dailies-complete.sh" ${c.id} ${e.id} ${value} ${t}`).join('; '))
  }
  const toggleOne = (c, e) => setDone(c, [{ e, value: isDone(c, e) ? 0 : 1 }])
  // Clicking a day's dot completes everything still open that day; once all are done, it reopens them.
  const toggleDay = (c, events) => {
    const open = events.filter((e) => !isDone(c, e))
    setDone(c, open.length ? open.map((e) => ({ e, value: 1 })) : events.map((e) => ({ e, value: 0 })))
  }

  // Today's bubble only lists what is still open, so completing the last event closes it.
  const bubbleLines = config.calendars.flatMap((c) =>
    ((calEvents[c.id] && calEvents[c.id][today]) || []).filter((e) => !isDone(c, e)).map((e) => ({ c, e })),
  )

  const eventLine = (c, e, key) => {
    const done = isDone(c, e)
    return (
      <div
        className={'dailies-line' + (done ? ' done' : '')}
        key={key}
        style={colorStyle(c)}
        role="button"
        aria-label={`${done ? 'Reopen' : 'Complete'}: ${e.title}`}
        onClick={(ev) => {
          ev.stopPropagation()
          toggleOne(c, e)
        }}
      >
        <i>{done && <Check size={7} width={2} />}</i>
        <span>
          {e.time && <em>{e.time} </em>}
          {e.title}
        </span>
      </div>
    )
  }

  return (
    <div className="dailies-card" style={anchor(config)}>
      <style>{css}</style>
      {config.calendars.length > 0 && (
        <button
          className={'dailies-refresh' + (refreshing ? ' busy' : '')}
          title="Refresh calendars"
          aria-label="Refresh calendars"
          onClick={() => window.__dailiesSync && window.__dailiesSync.refresh()}
        >
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13.2 8A5.2 5.2 0 1 1 11.7 4.3" />
            <path d="M13.4 2.2v3.3H10.1" />
          </svg>
        </button>
      )}
      {messages.length > 0 && (
        <div className={'dailies-errors' + (config.calendars.length ? ' beside-refresh' : '')}>
          {messages.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )}
      {!loaded && messages.length === 0 && <div className="dailies-streak">loading…</div>}
      {config.habits.length > 0 && (
        <div className="dailies-grid" style={grid}>
          {config.highlight_today && (
            // first in the grid and behind the content (z-index -1); an explicit end line makes it exactly today's column
            <div
              className={'dailies-today' + (weekStart(today, todayIdx) ? ' week' : '')}
              style={{ gridColumn: `${todayIdx + 2} / span 1`, gridRow: `1 / span ${rowCount}` }}
            />
          )}
          <div />
          {days.map((d, i) => {
            const dt = new Date(d + 'T12:00:00')
            return (
              <div key={d} className={'dailies-head' + (d === today ? ' today' : '') + (weekStart(d, i) ? ' week' : '')}>
                {WEEKDAY_LETTERS[config.week_starts][core.weekdayIndex(d, config.week_starts)]}
                <b>{dt.getDate()}</b>
              </div>
            )
          })}
          <div />

          {config.calendars.map((c) => [
            <div key={c.id + ':label'} className="dailies-label cal" title={calLabel(c)}>{calLabel(c)}</div>,
            ...days.map((d, i) => {
              const events = (calEvents[c.id] && calEvents[c.id][d]) || []
              const open = events.filter((e) => !isDone(c, e))
              const cls =
                'dailies-cal-cell' +
                (d < today ? ' past' : '') +
                (weekStart(d, i) ? ' week' : '') +
                (events.length ? ' has-events' : '')
              return (
                <div key={c.id + ':' + d} className={cls} style={colorStyle(c)} onClick={() => events.length && toggleDay(c, events)}>
                  {events.length > 0 && [
                    open.length ? <span key="dot" className="dailies-evdot" /> : <span key="dot" className="dailies-evcheck"><Check size={10} width={2.2} /></span>,
                    config.show_event_count && open.length > 1 && (
                      <span key="count" className="dailies-count">{open.length}</span>
                    ),
                    <div key="tip" className={`dailies-tip ${vertical} ${side(i)}`}>
                      {events.map((e, k) => eventLine(c, e, k))}
                    </div>,
                  ]}
                </div>
              )
            }),
            <div key={c.id + ':end'} />,
          ])}
          {config.calendars.length > 0 && <div className="dailies-sep" />}

          {config.habits.map((habit) => [
            <div key={habit.id + ':label'} className="dailies-label" title={habit.name}>{habit.name}</div>,
            ...days.map((d, i) => {
              const week = weekStart(d, i) ? ' week' : ''
              if (d > today) {
                return (
                  <div key={habit.id + '|' + d} className={'dailies-cell future' + week} style={colorStyle(habit)}>
                    <span className="dailies-dot" />
                  </div>
                )
              }
              const v = core.effectiveValue(values, pending, habit.id, d)
              const key = core.cellKey(habit.id, d)
              const cls = `dailies-cell s${v}` + (config.show_success_animation && pop === key ? ' pop' : '') + week
              return (
                <button
                  key={key}
                  className={cls}
                  style={colorStyle(habit)}
                  onClick={() => tap(habit, d)}
                  aria-label={`${habit.name}, ${d}`}
                >
                  <span className="dailies-dot" />
                </button>
              )
            }),
            <div key={habit.id + ':streak'} className="dailies-streak">
              {(() => {
                const s = core.streak(values, habit.id, today)
                return s >= 2 ? s : ''
              })()}
            </div>,
          ])}

          {bubbleLines.length > 0 && (
            <div
              className={`dailies-bubble ${vertical} ${side(todayIdx)}`}
              // an explicit end line makes the column itself the containing block ("auto" would mean the whole grid)
              style={{ gridColumn: `${todayIdx + 2} / span 1`, gridRow: `1 / span ${rowCount}` }}
            >
              {bubbleLines.slice(0, BUBBLE_MAX_LINES).map(({ c, e }, k) => eventLine(c, e, k))}
              {bubbleLines.length > BUBBLE_MAX_LINES && (
                <div className="dailies-more">+{bubbleLines.length - BUBBLE_MAX_LINES} more</div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

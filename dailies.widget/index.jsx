import { React, run } from 'uebersicht'
import core from './lib/core.js'

// Übersicht runs commands with the *widgets root* as cwd, so find our bin/
// folder whether this repo is symlinked as dailies.widget or cloned in a folder.
const LOCATE = 's=$(ls -d dailies.widget/bin ./*/dailies.widget/bin 2>/dev/null | head -1)'

export const command = `${LOCATE}; bash "$s/read.sh"`
export const refreshFrequency = 5000 // re-reads the log, so other screens/machines show up

// Full-screen, click-through layer; the card positions itself inside it.
export const className = `
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
`

const initial = core.normalizeConfig({ habits: [] })

export const initialState = {
  config: initial.config,
  errors: [],
  values: {},
  pending: {},
  pop: null,
  loaded: false,
  fetchError: null,
}

export const updateState = (event, prev) => {
  switch (event.type) {
    case 'UB/COMMAND_RAN': {
      if (event.error) return { ...prev, fetchError: String(event.error) }
      const { config, errors, values } = core.parseReadOutput(event.output)
      const pending = core.prunePending(prev.pending, values, Date.now())
      return { ...prev, config, errors, values, pending, loaded: true, fetchError: null }
    }
    case 'DAILIES/TAP': {
      const key = core.cellKey(event.habit, event.date)
      return {
        ...prev,
        pending: { ...prev.pending, [key]: { value: event.value, t: event.t } },
        pop: event.value === core.DONE ? key : null,
      }
    }
    default:
      return prev
  }
}

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DEFAULT_COLOR = '#5fd0a0'
const CELL = 26

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
  --edge: rgba(255,255,255,.10);
  font: 12px/1.2 -apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--edge);
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
    --edge: rgba(0,0,0,.08);
  }
}
.dailies-grid { display: grid; align-items: center; }
.dailies-label {
  padding-right: 14px; max-width: 170px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dailies-head { text-align: center; color: var(--muted); font-size: 10px; line-height: 1.25; padding-bottom: 4px; }
.dailies-head b { display: block; font-weight: 600; font-size: 11px; }
.dailies-head.today { color: var(--fg); }
.dailies-streak { padding-left: 10px; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
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
@keyframes dailies-pop { 0% { transform: scale(.6); } 60% { transform: scale(1.35); } 100% { transform: scale(1); } }
@keyframes dailies-ring { from { transform: scale(1); opacity: .8; } to { transform: scale(2.4); opacity: 0; } }
@media (prefers-reduced-motion: reduce) {
  .dailies-dot { transition: none; }
  .dailies-cell.s1.pop .dailies-dot, .dailies-cell.s1.pop::after { animation: none; }
}
.dailies-errors { color: #ff8a80; font-size: 11px; max-width: 320px; margin-bottom: 8px; }
.dailies-errors div + div { margin-top: 3px; }
`

export const render = (state, dispatch) => {
  const { config, errors, values, pending, pop, loaded, fetchError } = state
  const now = new Date()
  const today = core.dayKey(now, config.day_starts_at)
  const days = core.lastNDays(today, config.n_col)

  const messages = fetchError ? [fetchError, ...errors] : errors

  const tap = (habit, date) => {
    const value = core.nextValue(core.effectiveValue(values, pending, habit.id, date))
    const t = Date.now()
    dispatch({ type: 'DAILIES/TAP', habit: habit.id, date, value, t })
    run(`${LOCATE}; bash "$s/log.sh" ${habit.id} ${date} ${value} ${t}`)
  }

  const grid = {
    gridTemplateColumns: `auto repeat(${days.length}, ${CELL}px) auto`,
  }

  return (
    <div className="dailies-card" style={anchor(config)}>
      <style>{css}</style>
      {messages.length > 0 && (
        <div className="dailies-errors">
          {messages.map((m, i) => <div key={i}>{m}</div>)}
        </div>
      )}
      {!loaded && messages.length === 0 && <div className="dailies-streak">loading…</div>}
      {config.habits.length > 0 && (
        <div className="dailies-grid" style={grid}>
          <div />
          {days.map((d) => {
            const dt = new Date(d + 'T12:00:00')
            return (
              <div key={d} className={'dailies-head' + (d === today ? ' today' : '')}>
                {WEEKDAYS[dt.getDay()]}
                <b>{dt.getDate()}</b>
              </div>
            )
          })}
          <div />
          {config.habits.map((habit) => [
            <div key={habit.id + ':label'} className="dailies-label" title={habit.name}>{habit.name}</div>,
            ...days.map((d) => {
              const v = core.effectiveValue(values, pending, habit.id, d)
              const key = core.cellKey(habit.id, d)
              const cls = `dailies-cell s${v}` + (config.show_success_animation && pop === key ? ' pop' : '')
              return (
                <button
                  key={key}
                  className={cls}
                  style={{ '--c': habit.color || DEFAULT_COLOR }}
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
        </div>
      )}
    </div>
  )
}

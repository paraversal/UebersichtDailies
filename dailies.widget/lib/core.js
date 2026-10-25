// Pure logic for the Dailies widget. No DOM, no Übersicht APIs, so it can be
// unit-tested with plain node (see test/core.test.js).

const LOCATIONS = ['top_left', 'top_right', 'bottom_left', 'bottom_right']
const WEEK_STARTS = ['monday', 'sunday']
const ID_RE = /^[a-z0-9_-]+$/
const EMPTY = 0
const DONE = 1
const SKIPPED = 2
const PENDING_TTL_MS = 15000

const DEFAULTS = {
  n_col: 14,
  show_success_animation: true,
  location: 'bottom_left',
  margin: 20,
  day_starts_at: '00:00',
  week_starts: 'monday',
  n_future: 0,
  show_event_count: true,
  calendar_refresh_minutes: 30,
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Validates raw config JSON, filling in defaults. Never throws: problems are
// returned in `errors` so the widget can show them instead of rendering blank.
function normalizeConfig(raw) {
  const errors = []
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  if (src !== raw) errors.push('config must be a JSON object')

  const config = { ...DEFAULTS }

  if ('n_col' in src) {
    if (Number.isInteger(src.n_col) && src.n_col >= 1 && src.n_col <= 60) config.n_col = src.n_col
    else errors.push('n_col must be an integer between 1 and 60')
  }
  if ('show_success_animation' in src) {
    if (typeof src.show_success_animation === 'boolean') config.show_success_animation = src.show_success_animation
    else errors.push('show_success_animation must be true or false')
  }
  if ('location' in src) {
    if (LOCATIONS.includes(src.location)) config.location = src.location
    else errors.push('location must be one of ' + LOCATIONS.join(', '))
  }
  if ('margin' in src) {
    if (Number.isFinite(src.margin) && src.margin >= 0) config.margin = src.margin
    else errors.push('margin must be a non-negative number')
  }
  if ('day_starts_at' in src) {
    if (typeof src.day_starts_at === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(src.day_starts_at)) {
      config.day_starts_at = src.day_starts_at
    } else errors.push('day_starts_at must look like "04:00"')
  }

  if ('week_starts' in src) {
    if (WEEK_STARTS.includes(src.week_starts)) config.week_starts = src.week_starts
    else errors.push('week_starts must be "monday" or "sunday"')
  }

  if ('n_future' in src) {
    if (Number.isInteger(src.n_future) && src.n_future >= 0 && src.n_future <= 30) config.n_future = src.n_future
    else errors.push('n_future must be an integer between 0 and 30')
  }
  if ('show_event_count' in src) {
    if (typeof src.show_event_count === 'boolean') config.show_event_count = src.show_event_count
    else errors.push('show_event_count must be true or false')
  }
  if ('calendar_refresh_minutes' in src) {
    const m = src.calendar_refresh_minutes
    if (Number.isInteger(m) && m >= 5 && m <= 1440) config.calendar_refresh_minutes = m
    else errors.push('calendar_refresh_minutes must be an integer between 5 and 1440')
  }

  const habits = []
  const seen = new Set()
  const list = Array.isArray(src.habits) ? src.habits : []
  if (!Array.isArray(src.habits)) errors.push('habits must be a list')
  else if (list.length === 0) errors.push('habits is empty: add at least one habit')

  list.forEach((entry, i) => {
    const obj = typeof entry === 'string' ? { name: entry } : entry
    if (!obj || typeof obj !== 'object' || typeof obj.name !== 'string' || !obj.name.trim()) {
      errors.push(`habits[${i}] needs a name`)
      return
    }
    const id = obj.id !== undefined ? obj.id : slugify(obj.name)
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      errors.push(`habits[${i}] ("${obj.name}") needs an "id" made of a-z, 0-9, - or _`)
      return
    }
    if (seen.has(id)) {
      errors.push(`habits[${i}] ("${obj.name}") has a duplicate id "${id}"`)
      return
    }
    seen.add(id)
    habits.push({ id, name: obj.name.trim(), color: typeof obj.color === 'string' ? obj.color : null })
  })

  const hues = assignHues(habits)
  config.habits = habits.map((h) => ({ ...h, hue: hues[h.id] ?? null }))

  config.calendars = normalizeCalendars(src.calendars, errors)
  return { config, errors }
}

// Habits without an explicit `color` get a hue derived from their id, so it is
// stable across reloads. All habits share one lightness and chroma (set in the
// widget's CSS), which is what makes any set of hues look like one palette.
// Hues that land too close together are nudged apart by the golden angle.
const GOLDEN_ANGLE = 137.508

function hashHue(id) {
  let h = 2166136261 // FNV-1a
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) % 360
}

const hueDistance = (a, b) => {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

// Returns { habitId: hue } for every habit that has no explicit color.
function assignHues(habits) {
  const auto = habits.filter((h) => !h.color)
  const minGap = Math.min(45, 360 / (auto.length * 1.5 || 1))
  const taken = []
  const hues = {}
  for (const habit of auto) {
    let hue = hashHue(habit.id)
    for (let tries = 0; tries < 360 && taken.some((t) => hueDistance(t, hue) < minGap); tries++) {
      hue = (hue + GOLDEN_ANGLE) % 360
    }
    taken.push(hue)
    hues[habit.id] = Math.round(hue)
  }
  return hues
}

const CALENDAR_URL_RE = /^(webcals?|https?):\/\/[^\s"'\\]+$/

function shortHash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// calendars: [ "webcal://…", { "name", "url", "id"?, "color"? } ]. Optional.
// Without a name the feed's own title is used once it has been downloaded.
function normalizeCalendars(raw, errors) {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    errors.push('calendars must be a list')
    return []
  }
  const calendars = []
  const seen = new Set()
  raw.forEach((entry, i) => {
    const obj = typeof entry === 'string' ? { url: entry } : entry
    if (!obj || typeof obj !== 'object' || typeof obj.url !== 'string' || !CALENDAR_URL_RE.test(obj.url.trim())) {
      errors.push(`calendars[${i}] needs a "url" starting with webcal:// or https://`)
      return
    }
    const url = obj.url.trim()
    const name = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : null
    const id = obj.id !== undefined ? obj.id : (name && slugify(name)) || 'cal-' + shortHash(url)
    if (typeof id !== 'string' || !ID_RE.test(id)) {
      errors.push(`calendars[${i}] needs an "id" made of a-z, 0-9, - or _`)
      return
    }
    if (seen.has(id)) {
      errors.push(`calendars[${i}] has a duplicate id "${id}"`)
      return
    }
    seen.add(id)
    calendars.push({ id, name, url, color: typeof obj.color === 'string' ? obj.color : null })
  })
  // Hash with a prefix so a calendar named like a habit doesn't get the same hue.
  const hues = assignHues(calendars.map((c) => ({ id: 'cal:' + c.id, color: c.color })))
  return calendars.map((c) => ({ ...c, hue: hues['cal:' + c.id] ?? null }))
}

const pad = (n) => String(n).padStart(2, '0')

// The "day" a moment belongs to, as a local YYYY-MM-DD key. With
// day_starts_at "04:00", 02:30 still counts as the previous day.
function dayKey(date, dayStartsAt = '00:00') {
  const [h, m] = dayStartsAt.split(':').map(Number)
  const shifted = new Date(date.getTime() - (h * 60 + m) * 60000)
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`
}

function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d, 12) // noon: immune to DST shifts
}

// n day keys ending at todayKey, oldest first.
function lastNDays(todayKey, n) {
  const end = parseKey(todayKey)
  const days = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end)
    d.setDate(end.getDate() - i)
    days.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
  }
  return days
}

function addDays(key, n) {
  const d = parseKey(key)
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// nPast days ending at todayKey (today included) followed by nFuture days.
function dayRange(todayKey, nPast, nFuture) {
  const past = lastNDays(todayKey, nPast)
  const future = []
  for (let i = 1; i <= nFuture; i++) future.push(addDays(todayKey, i))
  return past.concat(future)
}

// 0-6 weekday index of a day key, counted from the configured first day of the week.
function weekdayIndex(key, weekStarts = 'monday') {
  const sundayFirst = parseKey(key).getDay()
  return weekStarts === 'sunday' ? sundayFirst : (sundayFirst + 6) % 7
}

// Replays JSONL log text into { habitId: { 'YYYY-MM-DD': value } }.
// Latest event (by t, then by line order) wins. Malformed lines are skipped.
function replayLog(text) {
  const events = []
  String(text || '')
    .split('\n')
    .forEach((line, order) => {
      if (!line.trim()) return
      try {
        const e = JSON.parse(line)
        if (typeof e.h === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.d) && [EMPTY, DONE, SKIPPED].includes(e.v)) {
          events.push({ h: e.h, d: e.d, v: e.v, t: Number(e.t) || 0, order })
        }
      } catch (_) {
        /* ignore partial or corrupt line */
      }
    })
  events.sort((a, b) => a.t - b.t || a.order - b.order)
  const values = {}
  for (const e of events) {
    if (!values[e.h]) values[e.h] = {}
    values[e.h][e.d] = e.v
  }
  return values
}

// Output of bin/dailies-read.sh: config JSON, a marker line, then the concatenated logs.
const LOG_MARKER = '---DAILIES-LOG---'
function parseReadOutput(output) {
  const text = String(output || '')
  const at = text.indexOf(LOG_MARKER)
  const configText = at === -1 ? text : text.slice(0, at)
  const logText = at === -1 ? '' : text.slice(at + LOG_MARKER.length)
  let raw
  let parseError = null
  try {
    raw = JSON.parse(configText)
  } catch (e) {
    parseError = 'config.json is not valid JSON: ' + e.message
  }
  const { config, errors } = normalizeConfig(raw)
  if (parseError) errors.unshift(parseError)
  return { config, errors, values: replayLog(logText) }
}

function nextValue(v) {
  return v === EMPTY ? DONE : v === DONE ? SKIPPED : EMPTY
}

const cellKey = (habitId, date) => `${habitId}|${date}`

// Value to show: an unconfirmed local tap wins over what the log says.
function effectiveValue(values, pending, habitId, date) {
  const p = pending[cellKey(habitId, date)]
  if (p) return p.value
  return (values[habitId] && values[habitId][date]) || EMPTY
}

// Drop pending taps the log has caught up with, or that are stale.
function prunePending(pending, values, now) {
  const kept = {}
  for (const [key, p] of Object.entries(pending)) {
    const [h, d] = key.split('|')
    const logged = (values[h] && values[h][d]) || EMPTY
    if (logged !== p.value && now - p.t < PENDING_TTL_MS) kept[key] = p
  }
  return kept
}

// Current run of consecutive days with DONE, ending today (or yesterday if
// today is still open). SKIPPED days neither extend nor break a streak.
function streak(values, habitId, todayKey) {
  const days = (values[habitId] || {})
  let count = 0
  let key = todayKey
  for (let i = 0; i < 3650; i++) {
    const v = days[key] || EMPTY
    if (v === DONE) count++
    else if (v === EMPTY && !(i === 0)) break
    const d = parseKey(key)
    d.setDate(d.getDate() - 1)
    key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  return count
}

module.exports = {
  EMPTY,
  DONE,
  SKIPPED,
  LOG_MARKER,
  DEFAULTS,
  LOCATIONS,
  WEEK_STARTS,
  slugify,
  normalizeConfig,
  assignHues,
  dayKey,
  lastNDays,
  addDays,
  dayRange,
  weekdayIndex,
  replayLog,
  parseReadOutput,
  nextValue,
  cellKey,
  effectiveValue,
  prunePending,
  streak,
}

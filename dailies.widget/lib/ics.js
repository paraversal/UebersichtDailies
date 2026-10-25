// iCalendar (.ics) parsing and recurrence expansion for the calendar rows.
// Pure and dependency-free so it can be tested with plain node
// (see test/ics.test.js). Covers what Apple/iCloud feeds actually contain:
// timed and all-day events, TZID/UTC/floating times, DURATION, EXDATE,
// RECURRENCE-ID overrides and the common RRULE forms (DAILY, WEEKLY,
// MONTHLY, YEARLY with INTERVAL, COUNT, UNTIL, BYDAY, BYMONTHDAY, BYMONTH).

const MS_DAY = 86400000
const pad = (n) => String(n).padStart(2, '0')

// ---- day arithmetic on whole days since 1970-01-01 (no DST surprises) ------

const dayNum = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY)
}
const ymd = (dn) => {
  const d = new Date(dn * MS_DAY)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
}
const keyOf = (dn) => {
  const { y, m, d } = ymd(dn)
  return `${y}-${pad(m)}-${pad(d)}`
}
const weekdayOf = (dn) => (((dn + 4) % 7) + 7) % 7 // 0 = Sunday
const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate()
const localKey = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ---- time zones ------------------------------------------------------------

const formatters = {}
const offsetCache = new Map()
// Zone offsets only change on 15-minute boundaries, so cache per bucket.
function tzOffsetMs(instant, tz) {
  const bucket = `${tz}|${Math.floor(instant / 900000)}`
  let off = offsetCache.get(bucket)
  if (off === undefined) {
    off = computeOffsetMs(Math.floor(instant / 900000) * 900000, tz)
    if (offsetCache.size > 50000) offsetCache.clear()
    offsetCache.set(bucket, off)
  }
  return off
}

function computeOffsetMs(instant, tz) {
  const f =
    formatters[tz] ||
    (formatters[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    }))
  const p = {}
  for (const { type, value } of f.formatToParts(new Date(instant))) p[type] = Number(value)
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return wall - Math.floor(instant / 1000) * 1000
}

// Wall-clock time in a named zone -> instant (ms). Unknown zones fall back to
// the machine's local zone, which is right for the common single-zone case.
function wallToInstant(date, h, mi, s, tz) {
  const [y, m, d] = date.split('-').map(Number)
  if (tz === 'UTC') return Date.UTC(y, m - 1, d, h, mi, s)
  if (tz) {
    try {
      const guess = Date.UTC(y, m - 1, d, h, mi, s)
      const off1 = tzOffsetMs(guess, tz)
      let t = guess - off1
      const off2 = tzOffsetMs(t, tz)
      if (off2 !== off1) t = guess - off2 // landed across a DST change
      return t
    } catch (_) {
      /* not an IANA name (e.g. a Windows zone): treat as floating */
    }
  }
  return new Date(y, m - 1, d, h, mi, s).getTime()
}

// ---- parsing ---------------------------------------------------------------

function unfold(text) {
  return String(text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
}

function splitUnquoted(s, sep) {
  const out = []
  let cur = ''
  let quoted = false
  for (const c of s) {
    if (c === '"') quoted = !quoted
    if (c === sep && !quoted) {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

function parseLine(line) {
  let quoted = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted
    else if (line[i] === ':' && !quoted) {
      colon = i
      break
    }
  }
  if (colon < 1) return null
  const parts = splitUnquoted(line.slice(0, colon), ';')
  const params = {}
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=')
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '')
  }
  return { name: parts[0].toUpperCase(), params, value: line.slice(colon + 1) }
}

const timeFormat = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit' })
const unescapeText = (s) => s.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c))

// DATE or DATE-TIME -> { allDay, date, h, mi, s, tz } wall-clock record.
function parseWhen(prop) {
  const v = prop.value.trim()
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v)
  if (m) return { allDay: true, date: `${m[1]}-${m[2]}-${m[3]}`, h: 0, mi: 0, s: 0, tz: null }
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v)
  if (m) {
    return {
      allDay: false,
      date: `${m[1]}-${m[2]}-${m[3]}`,
      h: +m[4],
      mi: +m[5],
      s: +(m[6] || 0),
      tz: m[7] ? 'UTC' : prop.params.TZID || null,
    }
  }
  return null
}

const instantOf = (w) => wallToInstant(w.date, w.h, w.mi, w.s, w.tz)

function parseDuration(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim())
  if (!m) return null
  const sign = m[1] === '-' ? -1 : 1
  const days = (+m[2] || 0) * 7 + (+m[3] || 0)
  const ms = ((+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000
  return { days: sign * days, ms: sign * ms }
}

const WEEKDAY_CODES = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }

function parseRrule(value) {
  const r = {}
  for (const part of value.split(';')) {
    const [k, v] = part.split('=')
    if (k && v !== undefined) r[k.toUpperCase()] = v
  }
  const freq = r.FREQ
  if (!['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(freq)) return null
  const nums = (s) => (s ? s.split(',').map(Number).filter((n) => !Number.isNaN(n)) : [])
  const byday = (r.BYDAY ? r.BYDAY.split(',') : [])
    .map((s) => /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(s.trim()))
    .filter(Boolean)
    .map((m) => ({ n: m[1] ? Number(m[1]) : 0, wd: WEEKDAY_CODES[m[2]] }))
  return {
    freq,
    interval: Math.max(1, Number(r.INTERVAL) || 1),
    count: r.COUNT ? Number(r.COUNT) : null,
    until: r.UNTIL ? parseWhen({ value: r.UNTIL, params: {} }) : null,
    byday,
    bymonthday: nums(r.BYMONTHDAY),
    bymonth: nums(r.BYMONTH),
    wkst: r.WKST && WEEKDAY_CODES[r.WKST] !== undefined ? WEEKDAY_CODES[r.WKST] : 1,
  }
}

function buildEvent(props) {
  const first = (name) => props.find((p) => p.name === name)
  const dtstart = first('DTSTART')
  const start = dtstart && parseWhen(dtstart)
  if (!start) return null
  const status = first('STATUS')
  if (status && status.value.trim().toUpperCase() === 'CANCELLED') return null

  // Length of the event: DTEND, else DURATION, else a day (all-day) / instant.
  let durDays = 1
  let durMs = 0
  const dtend = first('DTEND')
  const end = dtend && parseWhen(dtend)
  const dur = first('DURATION') && parseDuration(first('DURATION').value)
  if (end) {
    if (start.allDay) durDays = Math.max(1, dayNum(end.date) - dayNum(start.date))
    else durMs = Math.max(0, instantOf(end) - instantOf(start))
  } else if (dur) {
    if (start.allDay) durDays = Math.max(1, dur.days)
    else durMs = Math.max(0, dur.days * MS_DAY + dur.ms)
  }

  const exdates = []
  for (const p of props.filter((q) => q.name === 'EXDATE')) {
    for (const v of p.value.split(',')) {
      const w = parseWhen({ value: v, params: p.params })
      if (w) exdates.push(w)
    }
  }
  const rid = first('RECURRENCE-ID')
  const rrule = first('RRULE')
  const summary = first('SUMMARY')

  return {
    uid: first('UID') ? first('UID').value.trim() : null,
    title: summary ? unescapeText(summary.value).trim() || '(no title)' : '(no title)',
    start,
    durDays,
    durMs,
    rrule: rrule ? parseRrule(rrule.value) : null,
    exdates,
    recurrenceId: rid ? parseWhen(rid) : null,
  }
}

// Parses one feed into { name, events }. Never throws on malformed input.
function parseIcs(text) {
  let name = null
  const events = []
  let cur = null
  let alarm = 0
  for (const line of unfold(text)) {
    const p = parseLine(line)
    if (!p) continue
    if (p.name === 'BEGIN') {
      if (p.value === 'VEVENT') {
        cur = []
        alarm = 0
      } else if (cur && p.value === 'VALARM') alarm++
    } else if (p.name === 'END') {
      if (p.value === 'VEVENT' && cur) {
        const ev = buildEvent(cur)
        if (ev) events.push(ev)
        cur = null
      } else if (p.value === 'VALARM' && cur) alarm--
    } else if (cur) {
      if (!alarm) cur.push(p)
    } else if (p.name === 'X-WR-CALNAME') name = unescapeText(p.value).trim() || null
  }
  return { name, events }
}

// ---- output of bin/dailies-calendars.sh --------------------------------------

const HEADER = /^---DAILIES-(CAL|CALERR) id=([a-z0-9_-]+)(?: mtime=(\d+))?---$/

// -> { [calendarId]: { name, events, mtime, error } }
function parseCalendarOutput(output) {
  const sections = []
  let cur = null
  for (const line of String(output || '').split('\n')) {
    const m = HEADER.exec(line.replace(/\r$/, ''))
    if (m) {
      cur = { kind: m[1], id: m[2], mtime: m[3] ? Number(m[3]) : null, lines: [] }
      sections.push(cur)
    } else if (cur) cur.lines.push(line)
  }
  const out = {}
  for (const s of sections) {
    const entry = out[s.id] || (out[s.id] = { name: null, events: [], mtime: null, error: null })
    if (s.kind === 'CALERR') entry.error = s.lines.join(' ').trim() || 'could not fetch calendar'
    else {
      const { name, events } = parseIcs(s.lines.join('\n'))
      Object.assign(entry, { name, events, mtime: s.mtime })
    }
  }
  return out
}

// ---- recurrence ------------------------------------------------------------

function matchesRule(rule, dn, startDn) {
  if (dn < startDn) return false
  const wd = weekdayOf(dn)

  // Fast paths that need no calendar-date math (the bulk of COUNT-limited scans).
  const needsDate = rule.bymonth.length || rule.bymonthday.length || rule.freq === 'MONTHLY' || rule.freq === 'YEARLY'
  if (rule.freq === 'DAILY' && !needsDate) {
    return (dn - startDn) % rule.interval === 0 && (!rule.byday.length || rule.byday.some((b) => b.wd === wd))
  }
  if (rule.freq === 'WEEKLY' && !needsDate) {
    const weekStart = (n) => n - ((weekdayOf(n) - rule.wkst + 7) % 7)
    if (((weekStart(dn) - weekStart(startDn)) / 7) % rule.interval !== 0) return false
    return rule.byday.length ? rule.byday.some((b) => b.wd === wd) : wd === weekdayOf(startDn)
  }

  const cur = ymd(dn)
  const st = ymd(startDn)
  const dim = daysInMonth(cur.y, cur.m)

  // BYMONTHDAY / BYDAY (optionally ordinal, within the month) / default: same day-of-month as the start.
  const monthDayOk = () => {
    if (rule.bymonthday.length) return rule.bymonthday.some((n) => (n > 0 ? n === cur.d : dim + n + 1 === cur.d))
    if (rule.byday.length) {
      return rule.byday.some(({ n, wd: w }) => {
        if (w !== wd) return false
        if (!n) return true
        const nth = Math.floor((cur.d - 1) / 7) + 1
        const fromEnd = -(Math.floor((dim - cur.d) / 7) + 1)
        return n === nth || n === fromEnd
      })
    }
    return cur.d === st.d
  }

  if (rule.bymonth.length && !rule.bymonth.includes(cur.m)) return false

  switch (rule.freq) {
    case 'DAILY':
      if ((dn - startDn) % rule.interval !== 0) return false
      if (rule.byday.length && !rule.byday.some((b) => b.wd === wd)) return false
      return !rule.bymonthday.length || monthDayOk()
    case 'WEEKLY': {
      const weekStart = (n) => n - ((weekdayOf(n) - rule.wkst + 7) % 7)
      if (((weekStart(dn) - weekStart(startDn)) / 7) % rule.interval !== 0) return false
      return rule.byday.length ? rule.byday.some((b) => b.wd === wd) : wd === weekdayOf(startDn)
    }
    case 'MONTHLY':
      return ((cur.y - st.y) * 12 + (cur.m - st.m)) % rule.interval === 0 && monthDayOk()
    case 'YEARLY':
      if ((cur.y - st.y) % rule.interval !== 0) return false
      if (!rule.bymonth.length && cur.m !== st.m) return false
      return monthDayOk()
    default:
      return false
  }
}

const MAX_SCAN_DAYS = 36600

// Dates (as day numbers) on which an occurrence *starts*, covering the window.
function occurrenceDays(ev, fromDn, toDn) {
  const startDn = dayNum(ev.start.date)
  if (!ev.rrule) return startDn >= fromDn && startDn <= toDn ? [startDn] : []
  const rule = ev.rrule
  const out = []
  // COUNT depends on every earlier match, so it must be counted from the start.
  const scanFrom = rule.count ? startDn : Math.max(startDn, fromDn)
  const last = Math.min(toDn, scanFrom + MAX_SCAN_DAYS)
  let n = 0
  for (let dn = scanFrom; dn <= last; dn++) {
    if (!matchesRule(rule, dn, startDn)) continue
    n++
    if (rule.count && n > rule.count) break
    if (dn >= fromDn) out.push(dn)
  }
  return out
}

const sameInstantOrDate = (a, b) => (a.allDay ? a.date === b.date : instantOf(a) === instantOf(b))

// 53-bit string hash (cyrb53) as 14 hex digits: a short, shell-safe event id.
function hashKey(str) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

const wallStamp = (w) => `${w.date}T${pad(w.h)}${pad(w.mi)}`

// Identifies one occurrence so it can be marked completed. A one-off event keeps
// its id when rescheduled; every occurrence of a recurring event gets its own
// (moved instances keep the id of the slot they replace).
function eventId(ev, w) {
  const base = ev.uid || `${ev.title}@${wallStamp(ev.start)}`
  if (!ev.rrule && !ev.recurrenceId) return hashKey(base)
  return hashKey(`${base}|${wallStamp(ev.recurrenceId || w)}`)
}

// Expand events into { 'YYYY-MM-DD': [{ id, title, allDay, startMs, endMs, time }] }
// for every local day from startKey to endKey inclusive.
function expandEvents(events, startKey, endKey) {
  const fromDn = dayNum(startKey)
  const toDn = dayNum(endKey)
  const out = {}

  const emit = (id, title, allDay, startMs, endMs, firstDn, lastDn) => {
    for (let dn = Math.max(firstDn, fromDn); dn <= Math.min(lastDn, toDn); dn++) {
      const key = keyOf(dn)
      const isStart = dn === firstDn
      const time =
        allDay || !isStart
          ? null
          : timeFormat.format(startMs)
      ;(out[key] || (out[key] = [])).push({ id, title, allDay, startMs, endMs, time })
    }
  }

  const overrides = events.filter((e) => e.recurrenceId)
  const overridden = (ev, w) =>
    overrides.some((o) => o.uid && o.uid === ev.uid && sameInstantOrDate(o.recurrenceId, w))

  for (const ev of events) {
    const base = ev.start
    const startDn = dayNum(base.date)
    const lookback = ev.start.allDay ? ev.durDays : Math.ceil(ev.durMs / MS_DAY) + 1

    // A modified single instance (RECURRENCE-ID) stands on its own. The extra day on
    // each side covers the gap between the event's own time zone and local time.
    for (const dn of occurrenceDays(ev.recurrenceId ? { ...ev, rrule: null } : ev, fromDn - lookback - 1, toDn + 1)) {
      const w = { ...base, date: keyOf(dn) }
      if (!ev.recurrenceId && ev.rrule) {
        if (ev.exdates.some((x) => sameInstantOrDate(x, w))) continue
        if (overridden(ev, w)) continue
        const until = ev.rrule.until
        if (until) {
          if (base.allDay || until.allDay) {
            if (dn > dayNum(until.date)) continue
          } else if (instantOf(w) > instantOf(until)) continue
        }
      }
      if (base.allDay) {
        emit(eventId(ev, w), ev.title, true, null, null, dn, dn + ev.durDays - 1)
      } else {
        const startMs = instantOf(w)
        const endMs = startMs + ev.durMs
        const firstDn = dayNum(localKey(startMs))
        const lastDn = endMs > startMs ? dayNum(localKey(endMs - 1)) : firstDn
        emit(eventId(ev, w), ev.title, false, startMs, endMs, firstDn, lastDn)
      }
    }
  }

  for (const items of Object.values(out)) {
    items.sort((a, b) => (b.allDay ? 1 : 0) - (a.allDay ? 1 : 0) || (a.startMs || 0) - (b.startMs || 0) || a.title.localeCompare(b.title))
  }
  return out
}

module.exports = { parseIcs, parseCalendarOutput, expandEvents, wallToInstant, hashKey }

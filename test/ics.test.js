// Run with: node --test test/*.test.js
process.env.TZ = 'Europe/Berlin' // before any Date is created, so local-day mapping is deterministic

const test = require('node:test')
const assert = require('node:assert/strict')
const ics = require('../dailies.widget/lib/ics.js')

const wrap = (...vevents) =>
  ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:Work', ...vevents, 'END:VCALENDAR'].join('\r\n')
const vevent = (...lines) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n')

const expand = (text, from, to) => {
  const { events } = ics.parseIcs(text)
  return ics.expandEvents(events, from, to)
}
const titles = (days, key) => (days[key] || []).map((e) => e.title)
const keysWith = (days) => Object.keys(days).sort()

test('parses calendar name, unfolds long lines and unescapes text', () => {
  const text = wrap(
    vevent(
      'UID:1',
      'DTSTART;VALUE=DATE:20261025',
      'SUMMARY:Lunch\\, with a very long title that gets fo',
      ' lded by the exporter\\; really',
    ),
  )
  const parsed = ics.parseIcs(text)
  assert.equal(parsed.name, 'Work')
  assert.equal(parsed.events[0].title, 'Lunch, with a very long title that gets folded by the exporter; really')
})

test('timed event with TZID lands on the right local day', () => {
  const text = wrap(vevent('UID:1', 'DTSTART;TZID=Europe/Berlin:20260615T093000', 'DTEND;TZID=Europe/Berlin:20260615T103000', 'SUMMARY:Standup'))
  const days = expand(text, '2026-06-14', '2026-06-16')
  assert.deepEqual(keysWith(days), ['2026-06-15'])
  const [e] = days['2026-06-15']
  assert.equal(e.startMs, Date.UTC(2026, 5, 15, 7, 30)) // 09:30 CEST
  assert.equal(e.endMs - e.startMs, 3600000)
  assert.equal(e.allDay, false)
})

test('UTC time that crosses local midnight is shown on the local day', () => {
  const text = wrap(vevent('UID:1', 'DTSTART:20261024T223000Z', 'DTEND:20261024T233000Z', 'SUMMARY:Late')) // 00:30 local on the 25th
  const days = expand(text, '2026-10-24', '2026-10-26')
  assert.deepEqual(keysWith(days), ['2026-10-25'])
})

test('foreign time zones convert correctly, including DST', () => {
  const winter = ics.wallToInstant('2026-01-15', 9, 0, 0, 'America/New_York')
  const summer = ics.wallToInstant('2026-07-15', 9, 0, 0, 'America/New_York')
  assert.equal(winter, Date.UTC(2026, 0, 15, 14, 0)) // UTC-5
  assert.equal(summer, Date.UTC(2026, 6, 15, 13, 0)) // UTC-4
  // unknown zone name falls back to local time instead of throwing
  assert.equal(ics.wallToInstant('2026-07-15', 9, 0, 0, 'W. Europe Standard Time'), Date.UTC(2026, 6, 15, 7, 0))
})

test('all-day events: single day, multi-day (exclusive end) and no end', () => {
  const text = wrap(
    vevent('UID:1', 'DTSTART;VALUE=DATE:20261020', 'DTEND;VALUE=DATE:20261023', 'SUMMARY:Trip'),
    vevent('UID:2', 'DTSTART;VALUE=DATE:20261025', 'SUMMARY:Holiday'),
  )
  const days = expand(text, '2026-10-19', '2026-10-26')
  assert.deepEqual(keysWith(days), ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-25'])
  assert.equal(days['2026-10-25'][0].allDay, true)
})

test('timed event spanning midnight appears on both days; ending exactly at midnight does not spill', () => {
  const text = wrap(
    vevent('UID:1', 'DTSTART:20261024T200000Z', 'DTEND:20261025T040000Z', 'SUMMARY:Night'), // 22:00 -> 06:00 local
    vevent('UID:2', 'DTSTART;TZID=Europe/Berlin:20261026T220000', 'DTEND;TZID=Europe/Berlin:20261027T000000', 'SUMMARY:Film'),
  )
  const days = expand(text, '2026-10-24', '2026-10-28')
  assert.deepEqual(titles(days, '2026-10-24'), ['Night'])
  assert.deepEqual(titles(days, '2026-10-25'), ['Night'])
  assert.deepEqual(titles(days, '2026-10-26'), ['Film'])
  assert.deepEqual(titles(days, '2026-10-27'), [])
})

test('events outside the window are dropped, cancelled ones are ignored, alarms do not confuse parsing', () => {
  const text = wrap(
    vevent('UID:1', 'DTSTART;VALUE=DATE:20200101', 'SUMMARY:Old'),
    vevent('UID:2', 'DTSTART;VALUE=DATE:20261025', 'STATUS:CANCELLED', 'SUMMARY:Cancelled'),
    ['BEGIN:VEVENT', 'UID:3', 'DTSTART;VALUE=DATE:20261025', 'SUMMARY:Real', 'BEGIN:VALARM', 'TRIGGER:-PT15M', 'DTSTART;VALUE=DATE:20990101', 'END:VALARM', 'END:VEVENT'].join('\r\n'),
  )
  const days = expand(text, '2026-10-20', '2026-10-30')
  assert.deepEqual(titles(days, '2026-10-25'), ['Real'])
  assert.deepEqual(keysWith(days), ['2026-10-25'])
})

test('weekly with BYDAY and INTERVAL', () => {
  // every other week on Mon+Wed, starting Monday 2026-10-05
  const text = wrap(vevent('UID:1', 'DTSTART;TZID=Europe/Berlin:20261005T180000', 'DTEND;TZID=Europe/Berlin:20261005T190000', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE', 'SUMMARY:Class'))
  const days = expand(text, '2026-10-01', '2026-10-31')
  assert.deepEqual(keysWith(days), ['2026-10-05', '2026-10-07', '2026-10-19', '2026-10-21'])
})

test('weekly without BYDAY repeats on the start weekday; daily with COUNT stops', () => {
  const weekly = wrap(vevent('UID:1', 'DTSTART;VALUE=DATE:20261001', 'RRULE:FREQ=WEEKLY', 'SUMMARY:W')) // Thursday
  assert.deepEqual(keysWith(expand(weekly, '2026-10-01', '2026-10-31')), ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29'])
  const daily = wrap(vevent('UID:2', 'DTSTART;VALUE=DATE:20261010', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:D'))
  assert.deepEqual(keysWith(expand(daily, '2026-10-01', '2026-10-31')), ['2026-10-10', '2026-10-11', '2026-10-12'])
})

test('COUNT is counted from the start even when the window begins later', () => {
  const text = wrap(vevent('UID:1', 'DTSTART;VALUE=DATE:20260101', 'RRULE:FREQ=DAILY;COUNT=300', 'SUMMARY:Long'))
  // day 300 is 2026-10-27
  const days = expand(text, '2026-10-24', '2026-11-05')
  assert.deepEqual(keysWith(days), ['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27'])
})

test('UNTIL ends a series (date and UTC date-time forms)', () => {
  const a = wrap(vevent('UID:1', 'DTSTART;VALUE=DATE:20261020', 'RRULE:FREQ=DAILY;UNTIL=20261022', 'SUMMARY:A'))
  assert.deepEqual(keysWith(expand(a, '2026-10-19', '2026-10-30')), ['2026-10-20', '2026-10-21', '2026-10-22'])
  const b = wrap(vevent('UID:2', 'DTSTART;TZID=Europe/Berlin:20261020T090000', 'DTEND;TZID=Europe/Berlin:20261020T100000', 'RRULE:FREQ=DAILY;UNTIL=20261022T070000Z', 'SUMMARY:B'))
  // 09:00 CEST = 07:00Z, so the 22nd (07:00Z) is still included
  assert.deepEqual(keysWith(expand(b, '2026-10-19', '2026-10-30')), ['2026-10-20', '2026-10-21', '2026-10-22'])
})

test('monthly: same day, nth weekday, last weekday, last day of month', () => {
  const same = wrap(vevent('UID:1', 'DTSTART;VALUE=DATE:20260131', 'RRULE:FREQ=MONTHLY', 'SUMMARY:31st'))
  // months without a 31st are skipped
  assert.deepEqual(keysWith(expand(same, '2026-02-01', '2026-05-31')), ['2026-03-31', '2026-05-31'])
  const second = wrap(vevent('UID:2', 'DTSTART;VALUE=DATE:20261013', 'RRULE:FREQ=MONTHLY;BYDAY=2TU', 'SUMMARY:2nd Tue'))
  assert.deepEqual(keysWith(expand(second, '2026-10-01', '2026-12-31')), ['2026-10-13', '2026-11-10', '2026-12-08'])
  const lastFri = wrap(vevent('UID:3', 'DTSTART;VALUE=DATE:20261030', 'RRULE:FREQ=MONTHLY;BYDAY=-1FR', 'SUMMARY:last Fri'))
  assert.deepEqual(keysWith(expand(lastFri, '2026-10-01', '2026-12-31')), ['2026-10-30', '2026-11-27', '2026-12-25'])
  const lastDay = wrap(vevent('UID:4', 'DTSTART;VALUE=DATE:20261031', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1', 'SUMMARY:eom'))
  assert.deepEqual(keysWith(expand(lastDay, '2026-10-01', '2027-02-28')), ['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28'])
})

test('yearly birthdays recur across years and skip Feb 29 in non-leap years', () => {
  const bday = wrap(vevent('UID:1', 'DTSTART;VALUE=DATE:19900314', 'RRULE:FREQ=YEARLY', 'SUMMARY:Birthday'))
  assert.deepEqual(keysWith(expand(bday, '2026-03-01', '2026-03-31')), ['2026-03-14'])
  const leap = wrap(vevent('UID:2', 'DTSTART;VALUE=DATE:20240229', 'RRULE:FREQ=YEARLY', 'SUMMARY:Leap'))
  assert.deepEqual(keysWith(expand(leap, '2026-02-01', '2026-03-31')), [])
  assert.deepEqual(keysWith(expand(leap, '2028-02-01', '2028-03-31')), ['2028-02-29'])
})

test('EXDATE removes one occurrence', () => {
  const text = wrap(vevent('UID:1', 'DTSTART;TZID=Europe/Berlin:20261019T090000', 'DTEND;TZID=Europe/Berlin:20261019T100000', 'RRULE:FREQ=DAILY;COUNT=4', 'EXDATE;TZID=Europe/Berlin:20261021T090000', 'SUMMARY:Daily'))
  assert.deepEqual(keysWith(expand(text, '2026-10-18', '2026-10-30')), ['2026-10-19', '2026-10-20', '2026-10-22'])
})

test('RECURRENCE-ID override replaces that instance (moved and retitled)', () => {
  const text = wrap(
    vevent('UID:S', 'DTSTART;TZID=Europe/Berlin:20261019T090000', 'DTEND;TZID=Europe/Berlin:20261019T100000', 'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:Sync'),
    vevent('UID:S', 'RECURRENCE-ID;TZID=Europe/Berlin:20261020T090000', 'DTSTART;TZID=Europe/Berlin:20261022T150000', 'DTEND;TZID=Europe/Berlin:20261022T160000', 'SUMMARY:Sync (moved)'),
  )
  const days = expand(text, '2026-10-18', '2026-10-30')
  assert.deepEqual(titles(days, '2026-10-19'), ['Sync'])
  assert.deepEqual(titles(days, '2026-10-20'), [])
  assert.deepEqual(titles(days, '2026-10-21'), ['Sync'])
  assert.deepEqual(titles(days, '2026-10-22'), ['Sync (moved)'])
})

test('DURATION is honoured and a long recurring event started in the past still shows', () => {
  const text = wrap(vevent('UID:1', 'DTSTART;VALUE=DATE:20260101', 'DURATION:P3D', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=24', 'SUMMARY:Retreat'))
  // started on the 24th, runs 24,25,26; window opens on the 25th (mid-event)
  const days = expand(text, '2026-10-25', '2026-10-30')
  assert.deepEqual(keysWith(days), ['2026-10-25', '2026-10-26'])
})

test('per-day order: all-day first, then by start time', () => {
  const text = wrap(
    vevent('UID:1', 'DTSTART;TZID=Europe/Berlin:20261025T150000', 'DTEND;TZID=Europe/Berlin:20261025T160000', 'SUMMARY:Afternoon'),
    vevent('UID:2', 'DTSTART;TZID=Europe/Berlin:20261025T080000', 'DTEND;TZID=Europe/Berlin:20261025T090000', 'SUMMARY:Morning'),
    vevent('UID:3', 'DTSTART;VALUE=DATE:20261025', 'SUMMARY:All day'),
  )
  assert.deepEqual(titles(expand(text, '2026-10-25', '2026-10-25'), '2026-10-25'), ['All day', 'Morning', 'Afternoon'])
})

test('garbage input does not throw', () => {
  assert.deepEqual(ics.parseIcs('').events, [])
  assert.deepEqual(ics.parseIcs('not a calendar\n\x00\x01').events, [])
  assert.deepEqual(ics.parseIcs(wrap(vevent('UID:1', 'DTSTART:nonsense', 'SUMMARY:x'))).events, [])
})

test('parseCalendarOutput splits per calendar and surfaces fetch errors', () => {
  const out = [
    '---DAILIES-CAL id=work mtime=1700000000---',
    wrap(vevent('UID:1', 'DTSTART;VALUE=DATE:20261025', 'SUMMARY:A')),
    '---DAILIES-CAL id=home mtime=1700000100---',
    wrap(vevent('UID:2', 'DTSTART;VALUE=DATE:20261026', 'SUMMARY:B')),
    '---DAILIES-CALERR id=home---',
    'curl: (6) Could not resolve host',
    '---DAILIES-CALERR id=nocache---',
    'HTTP 404',
  ].join('\n')
  const r = ics.parseCalendarOutput(out)
  assert.equal(r.work.events.length, 1)
  assert.equal(r.work.name, 'Work')
  assert.equal(r.work.mtime, 1700000000)
  assert.equal(r.home.events[0].title, 'B')
  assert.match(r.home.error, /Could not resolve/)
  assert.equal(r.nocache.events.length, 0)
  assert.deepEqual(ics.parseCalendarOutput(''), {})
})

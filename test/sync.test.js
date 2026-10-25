// Run with: node --test test/*.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { startCalendarSync } = require('../dailies.widget/lib/calendar-sync.js')

const LOCATE = 's=bin'
const calendars = [
  { id: 'work', url: 'webcal://example.com/work' },
  { id: 'home', url: 'webcal://example.com/home' },
]

function harness() {
  const commands = []
  const events = []
  let output = 'v1'
  const run = (cmd) => {
    commands.push(cmd)
    return Promise.resolve(cmd.includes('dailies-calendars.sh') ? output : '')
  }
  return { commands, events, setOutput: (o) => (output = o), run, dispatch: (e) => events.push(e) }
}

const fetches = (h) => h.commands.filter((c) => c.includes('dailies-fetch.sh'))
const settle = () => new Promise((r) => setTimeout(r, 20))

test('start reads the cache first, then downloads, and sends the URL on stdin only', async () => {
  const h = harness()
  const sync = startCalendarSync({ run: h.run, dispatch: h.dispatch, locate: LOCATE, calendars, refreshMinutes: 30 })
  await settle()
  sync.stop()
  assert.ok(h.commands[0].includes('dailies-calendars.sh'), 'cached events show before any download')
  assert.equal(fetches(h).length, 2)
  for (const c of fetches(h)) {
    assert.match(c, /dailies-fetch\.sh" (work|home) 30 <<'DAILIES_URL'\nwebcal:\/\/example\.com\/(work|home)\nDAILIES_URL\n$/)
    assert.ok(!/ force/.test(c))
  }
  assert.equal(h.events.filter((e) => e.type === 'DAILIES/CALENDARS').length, 1, 'unchanged output is dispatched once')
})

test('refresh forces every download, reports busy, then busy off, and picks up new data', async () => {
  const h = harness()
  const sync = startCalendarSync({ run: h.run, dispatch: h.dispatch, locate: LOCATE, calendars, refreshMinutes: 30 })
  await settle()
  h.commands.length = 0
  h.events.length = 0
  h.setOutput('v2')

  await sync.refresh()
  sync.stop()

  assert.equal(fetches(h).length, 2)
  assert.ok(fetches(h).every((c) => / 30 force <</.test(c)), 'refresh must pass the force flag')
  assert.deepEqual(
    h.events.map((e) => (e.type === 'DAILIES/REFRESHING' ? 'busy=' + e.busy : e.type + ':' + e.output)),
    ['busy=true', 'DAILIES/CALENDARS:v2', 'busy=false'],
  )
})

test('a second refresh while one is running is ignored; stop() ends everything', async () => {
  const h = harness()
  const sync = startCalendarSync({ run: h.run, dispatch: h.dispatch, locate: LOCATE, calendars, refreshMinutes: 30 })
  await settle()
  h.commands.length = 0
  const first = sync.refresh()
  const second = sync.refresh()
  await Promise.all([first, second])
  assert.equal(fetches(h).length, 2, 'only one refresh ran')

  sync.stop()
  h.commands.length = 0
  await sync.refresh()
  assert.equal(h.commands.length, 0, 'refresh after stop does nothing')
})

test('a failing run never rejects out of refresh', async () => {
  const events = []
  const sync = startCalendarSync({
    run: () => Promise.reject(new Error('boom')),
    dispatch: (e) => events.push(e),
    locate: LOCATE,
    calendars,
    refreshMinutes: 30,
  })
  await settle()
  await sync.refresh()
  sync.stop()
  assert.deepEqual(events.filter((e) => e.type === 'DAILIES/REFRESHING').map((e) => e.busy), [true, false])
})

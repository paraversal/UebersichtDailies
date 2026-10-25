// Run with: node --test test/*.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { execFile } = require('node:child_process')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const ics = require('../dailies.widget/lib/ics.js')
const bin = path.join(__dirname, '..', 'dailies.widget', 'bin')

const FEED = 'BEGIN:VCALENDAR\r\nX-WR-CALNAME:Test\r\nBEGIN:VEVENT\r\nUID:1\r\nDTSTART;VALUE=DATE:20261025\r\nSUMMARY:Hello\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'

function sh(script, args, { env, input = '' }) {
  return new Promise((resolve) => {
    const child = execFile('bash', [path.join(bin, script), ...args], { env }, (error, stdout, stderr) =>
      resolve({ code: error ? error.code : 0, stdout, stderr }),
    )
    child.stdin.end(input)
  })
}

async function withServer(handler, fn) {
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push(req.url)
    handler(req, res)
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    await fn(`http://127.0.0.1:${server.address().port}`, hits)
  } finally {
    server.close()
  }
}

test('fetch caches a feed, skips while fresh, and read output round-trips', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailies-fetch-'))
  const env = { ...process.env, DAILIES_DATA_DIR: dir }
  await withServer(
    (req, res) => res.end(FEED),
    async (base, hits) => {
      const first = await sh('dailies-fetch.sh', ['work', '30'], { env, input: base + '/feed.ics\n' })
      assert.equal(first.code, 0, first.stderr)
      assert.equal(hits.length, 1)
      assert.ok(fs.existsSync(path.join(dir, 'cache', 'cal-work.ics')))

      const second = await sh('dailies-fetch.sh', ['work', '30'], { env, input: base + '/feed.ics\n' })
      assert.equal(second.code, 0)
      assert.equal(hits.length, 1, 'fresh cache must not trigger a download')

      const out = (await sh('dailies-calendars.sh', [], { env })).stdout
      const parsed = ics.parseCalendarOutput(out)
      assert.equal(parsed.work.name, 'Test')
      assert.equal(parsed.work.events[0].title, 'Hello')
      assert.ok(parsed.work.mtime > 0)
      assert.equal(parsed.work.error, null)
    },
  )
  fs.rmSync(dir, { recursive: true })
})

test('a failed download keeps the old cache, records a short error and backs off', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailies-fetch-'))
  const env = { ...process.env, DAILIES_DATA_DIR: dir }
  let status = 200
  await withServer(
    (req, res) => {
      res.statusCode = status
      res.end(status === 200 ? FEED : 'nope')
    },
    async (base, hits) => {
      await sh('dailies-fetch.sh', ['home', '0'], { env, input: base + '/secret-token-123\n' })
      const cached = fs.readFileSync(path.join(dir, 'cache', 'cal-home.ics'), 'utf8')

      status = 500
      fs.rmSync(path.join(dir, 'cache', 'cal-home.attempt')) // pretend the last try was long ago
      await sh('dailies-fetch.sh', ['home', '0'], { env, input: base + '/secret-token-123\n' })
      assert.equal(fs.readFileSync(path.join(dir, 'cache', 'cal-home.ics'), 'utf8'), cached)
      const err = fs.readFileSync(path.join(dir, 'cache', 'cal-home.err'), 'utf8')
      assert.ok(err.length > 0 && err.length <= 300)
      assert.ok(!err.includes('secret-token-123'), 'the secret URL must never be echoed into the error')

      const before = hits.length
      await sh('dailies-fetch.sh', ['home', '0'], { env, input: base + '/secret-token-123\n' })
      assert.equal(hits.length, before, 'must back off right after a failed attempt')

      const parsed = ics.parseCalendarOutput((await sh('dailies-calendars.sh', [], { env })).stdout)
      assert.equal(parsed.home.events.length, 1)
      assert.ok(parsed.home.error)
    },
  )
  fs.rmSync(dir, { recursive: true })
})

test('a response that is not a calendar is rejected and not cached', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailies-fetch-'))
  const env = { ...process.env, DAILIES_DATA_DIR: dir }
  await withServer(
    (req, res) => res.end('<html>please log in</html>'),
    async (base) => {
      await sh('dailies-fetch.sh', ['x', '30'], { env, input: base + '/\n' })
      assert.ok(!fs.existsSync(path.join(dir, 'cache', 'cal-x.ics')))
      assert.match(fs.readFileSync(path.join(dir, 'cache', 'cal-x.err'), 'utf8'), /iCalendar/)
    },
  )
  fs.rmSync(dir, { recursive: true })
})

test('fetch rejects bad ids, ages and urls without touching the network', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailies-fetch-'))
  const env = { ...process.env, DAILIES_DATA_DIR: dir }
  const good = 'https://example.com/a.ics\n'
  for (const [args, input] of [
    [['bad id', '30'], good],
    [['ok', 'soon'], good],
    [['ok', '30'], 'ftp://example.com/a.ics\n'],
    [['ok', '30'], 'https://example.com/a b.ics\n'],
    [['ok', '30'], 'https://example.com/"; rm -rf /\n'],
    [['ok', '30'], '\n'],
  ]) {
    const r = await sh('dailies-fetch.sh', args, { env, input })
    assert.notEqual(r.code, 0, JSON.stringify([args, input]))
  }
  fs.rmSync(dir, { recursive: true })
})

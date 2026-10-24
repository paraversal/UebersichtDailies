// Run with: node --test test/
const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const core = require('../dailies.widget/lib/core.js')
const bin = path.join(__dirname, '..', 'dailies.widget', 'bin')

test('normalizeConfig fills defaults and slugifies string habits', () => {
  const { config, errors } = core.normalizeConfig({ habits: ['Go to sleep on time'] })
  assert.deepEqual(errors, [])
  assert.equal(config.n_col, 14)
  assert.equal(config.location, 'bottom_left')
  assert.deepEqual(config.habits, [{ id: 'go-to-sleep-on-time', name: 'Go to sleep on time', color: null }])
})

test('normalizeConfig reports problems instead of throwing', () => {
  const { config, errors } = core.normalizeConfig({
    n_col: 0,
    location: 'middle',
    habits: ['a', 'a', { name: 'b', id: 'Bad Id' }, { name: '日本語' }, 5],
  })
  assert.equal(config.n_col, 14)
  assert.equal(config.habits.length, 1)
  assert.equal(errors.length, 6)
  assert.ok(core.normalizeConfig(null).errors.length > 0)
})

test('dayKey honours day_starts_at', () => {
  const late = new Date(2026, 9, 25, 2, 30)
  assert.equal(core.dayKey(late, '00:00'), '2026-10-25')
  assert.equal(core.dayKey(late, '04:00'), '2026-10-24')
})

test('weekdayIndex follows week_starts', () => {
  // 2026-10-25 is a Sunday
  assert.equal(core.weekdayIndex('2026-10-25', 'monday'), 6)
  assert.equal(core.weekdayIndex('2026-10-26', 'monday'), 0)
  assert.equal(core.weekdayIndex('2026-10-25', 'sunday'), 0)
  assert.equal(core.normalizeConfig({ habits: ['a'], week_starts: 'friday' }).errors.length, 1)
  assert.equal(core.normalizeConfig({ habits: ['a'] }).config.week_starts, 'monday')
})

test('lastNDays is oldest-first and crosses month and DST boundaries', () => {
  assert.deepEqual(core.lastNDays('2026-03-02', 4), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02'])
  const days = core.lastNDays('2026-11-02', 5) // US DST ends 2026-11-01
  assert.deepEqual(days, ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
})

test('replayLog: last event wins, bad lines are skipped, clock order beats file order', () => {
  const log = [
    '{"t":1,"h":"a","d":"2026-10-25","v":1}',
    'garbage{',
    '{"t":3,"h":"a","d":"2026-10-25","v":0}',
    '{"t":2,"h":"a","d":"2026-10-25","v":2}', // older than the v:0 above
    '{"t":5,"h":"b","d":"2026-10-24","v":9}', // invalid value
    '{"t":6,"h":"b","d":"2026-10-24","v":1}',
    '{"t":6,"h":"b","d":"2026-10-24","v":2}', // same t: line order decides
  ].join('\n')
  assert.deepEqual(core.replayLog(log), { a: { '2026-10-25': 0 }, b: { '2026-10-24': 2 } })
})

test('parseReadOutput splits config from log and survives bad JSON', () => {
  const ok = core.parseReadOutput(
    '{"habits":["x"]}\n' + core.LOG_MARKER + '\n{"t":1,"h":"x","d":"2026-10-25","v":1}\n',
  )
  assert.deepEqual(ok.errors, [])
  assert.equal(ok.values.x['2026-10-25'], 1)
  const bad = core.parseReadOutput('{nope\n' + core.LOG_MARKER + '\n')
  assert.match(bad.errors[0], /not valid JSON/)
})

test('nextValue cycles empty -> done -> skipped -> empty', () => {
  assert.deepEqual([0, 1, 2].map(core.nextValue), [1, 2, 0])
})

test('pending taps override the log until the log catches up or they expire', () => {
  const values = { a: { '2026-10-25': 0 } }
  const key = core.cellKey('a', '2026-10-25')
  const pending = { [key]: { value: 1, t: 1000 } }
  assert.equal(core.effectiveValue(values, pending, 'a', '2026-10-25'), 1)
  assert.deepEqual(core.prunePending(pending, values, 2000), pending)
  assert.deepEqual(core.prunePending(pending, { a: { '2026-10-25': 1 } }, 2000), {})
  assert.deepEqual(core.prunePending(pending, values, 1000 + 20000), {})
})

test('streak counts consecutive DONE days; skipped bridges, open today does not break', () => {
  const v = { a: { '2026-10-25': 1, '2026-10-24': 2, '2026-10-23': 1, '2026-10-22': 1 } }
  assert.equal(core.streak(v, 'a', '2026-10-25'), 3)
  const open = { a: { '2026-10-24': 1, '2026-10-23': 1 } }
  assert.equal(core.streak(open, 'a', '2026-10-25'), 2)
  assert.equal(core.streak({}, 'a', '2026-10-25'), 0)
})

test('log.sh appends valid events and rejects bad input; read.sh round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailies-test-'))
  const env = { ...process.env, DAILIES_DATA_DIR: dir }
  const log = (...args) => execFileSync('bash', [path.join(bin, 'log.sh'), ...args], { env, stdio: 'pipe' })

  log('go-to-sleep', '2026-10-25', '1', '1000')
  log('go-to-sleep', '2026-10-25', '2', '2000')
  assert.throws(() => log('bad id; rm -rf /', '2026-10-25', '1'))
  assert.throws(() => log('x', '2026-10-25', '7'))
  assert.throws(() => log('x', 'yesterday', '1'))

  const files = fs.readdirSync(dir)
  assert.equal(files.length, 1)
  assert.match(files[0], /^log-.+\.jsonl$/)
  assert.equal(fs.readFileSync(path.join(dir, files[0]), 'utf8').trim().split('\n').length, 2)

  const out = execFileSync('bash', [path.join(bin, 'read.sh')], { env }).toString()
  const parsed = core.parseReadOutput(out)
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.values['go-to-sleep']['2026-10-25'], 2)
  fs.rmSync(dir, { recursive: true })
})

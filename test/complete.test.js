// Run with: node --test test/*.test.js
const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const core = require('../dailies.widget/lib/core.js')
const bin = path.join(__dirname, '..', 'dailies.widget', 'bin')

const EVENT = '00aabbccddeeff'

test('dailies-complete.sh appends valid marks, rejects bad input, and shares the habit log', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dailies-complete-'))
  const env = { ...process.env, DAILIES_DATA_DIR: dir }
  const complete = (...args) => execFileSync('bash', [path.join(bin, 'dailies-complete.sh'), ...args], { env, stdio: 'pipe' })

  complete('work', EVENT, '1', '1000')
  complete('work', EVENT, '0', '2000')
  complete('home', '1122334455667788', '1', '3000')
  execFileSync('bash', [path.join(bin, 'dailies-log.sh'), 'read', '2026-10-25', '1', '4000'], { env })

  for (const args of [
    ['Bad Id', EVENT, '1'],
    ['work', 'xyz', '1'],
    ['work', EVENT + '; rm -rf /', '1'],
    ['work', EVENT, '2'],
    ['work', EVENT, '1', 'now'],
    ['work', 'ABCDEF12', '1'], // ids are lowercase hex
  ]) assert.throws(() => complete(...args), undefined, JSON.stringify(args))

  const files = fs.readdirSync(dir)
  assert.equal(files.length, 1, 'habits and completions go to the same per-machine log')
  const out = execFileSync('bash', [path.join(bin, 'dailies-read.sh')], { env }).toString()
  const parsed = core.parseReadOutput(out)
  assert.deepEqual(parsed.errors, [])
  assert.deepEqual(parsed.completions, { ['work|' + EVENT]: 0, 'home|1122334455667788': 1 })
  assert.equal(parsed.values.read['2026-10-25'], 1, 'completion lines do not disturb habit replay')
  fs.rmSync(dir, { recursive: true })
})

test('replayCompletions: latest wins, clock order beats file order, junk is skipped', () => {
  const lines = [
    { t: 5, cal: 'a', e: EVENT, v: 0 },
    { t: 1, cal: 'a', e: EVENT, v: 1 }, // older, listed later
    { t: 2, cal: 'b', e: EVENT, v: 1 },
    { t: 3, cal: 'a', e: 'not-hex', v: 1 },
    { t: 4, cal: 'a', e: EVENT, v: 7 },
    { t: 6, h: 'habit', d: '2026-10-25', v: 1 },
  ]
    .map((l) => JSON.stringify(l))
    .concat(['garbage{'])
    .join('\n')
  assert.deepEqual(core.replayCompletions(lines), { ['a|' + EVENT]: 0, ['b|' + EVENT]: 1 })
  assert.deepEqual(core.replayCompletions(''), {})
})

test('pending completions override the log until it catches up or they expire', () => {
  const key = core.doneKey('work', EVENT)
  const pending = { [key]: { value: 1, t: 1000 } }
  assert.equal(core.effectiveDone({}, pending, 'work', EVENT), 1)
  assert.equal(core.effectiveDone({}, {}, 'work', EVENT), 0)
  assert.equal(core.effectiveDone({ [key]: 1 }, {}, 'work', EVENT), 1)
  assert.deepEqual(core.prunePendingDone(pending, {}, 2000), pending)
  assert.deepEqual(core.prunePendingDone(pending, { [key]: 1 }, 2000), {})
  assert.deepEqual(core.prunePendingDone(pending, {}, 1000 + 20000), {})
  // an un-complete click stays pending while the log still says done
  assert.equal(core.effectiveDone({ [key]: 1 }, { [key]: { value: 0, t: 1 } }, 'work', EVENT), 0)
})

// Run with: node --test test/*.test.js
// Guards what the Übersicht gallery (and the README) need from the repo root.
const test = require('node:test')
const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const file = (name) => path.join(root, name)

function pngSize(p) {
  const d = fs.readFileSync(p)
  assert.equal(d.subarray(1, 4).toString(), 'PNG', p + ' is not a PNG')
  return { w: d.readUInt32BE(16), h: d.readUInt32BE(20) }
}

test('widget.json has the four fields the gallery asks for, and a short description', () => {
  const j = JSON.parse(fs.readFileSync(file('widget.json'), 'utf8'))
  assert.deepEqual(Object.keys(j).sort(), ['author', 'description', 'email', 'name'])
  for (const v of Object.values(j)) assert.ok(typeof v === 'string' && v.trim())
  assert.ok(j.description.length <= 60, 'the gallery wants a short(!) description')
  assert.match(j.email, /@/)
})

test('screenshot.png is the gallery thumbnail size (hi-res: 516x320, not scaled or squashed)', () => {
  const { w, h } = pngSize(file('screenshot.png'))
  assert.deepEqual([w, h], [516, 320])
})

test('every image the README shows exists', () => {
  const readme = fs.readFileSync(file('README.md'), 'utf8')
  const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1])
  assert.ok(images.length > 0)
  for (const img of images) assert.ok(fs.existsSync(file(img)), `README references missing ${img}`)
})

test('dailies.widget.zip, once built, is a single dailies.widget folder without private files', { skip: !fs.existsSync(file('dailies.widget.zip')) && 'zip not built yet (npm version builds it)' }, () => {
  const names = execFileSync('unzip', ['-Z1', file('dailies.widget.zip')]).toString().trim().split('\n')
  assert.ok(names.every((n) => n.startsWith('dailies.widget/')), 'everything lives in dailies.widget/')
  for (const must of ['dailies.widget/index.jsx', 'dailies.widget/lib/core.js', 'dailies.widget/bin/dailies-read.sh', 'dailies.widget/config.example.json', 'dailies.widget/LICENSE']) {
    assert.ok(names.includes(must), 'zip is missing ' + must)
  }
  assert.ok(!names.some((n) => /config\.json$|\.DS_Store$|node_modules/.test(n)), 'zip must not contain config.json, .DS_Store or node_modules')
})

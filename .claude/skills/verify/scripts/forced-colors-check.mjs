#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: forced-colors-check.mjs <run-dir>')
  process.exit(2)
}

const MIN_NODES = { 'tool-running': 2, approval: 3, settled: 5, 'settled-expanded': 2 }
const MIN_COVERAGE = 0.95
const NODE_WIDTH = 7
const NODE_MAX_WIDTH = 30

function load(path) {
  const [width, height] = execFileSync('magick', ['identify', '-format', '%w %h', path], { encoding: 'utf8' }).split(' ').map(Number)
  const rgb = execFileSync('magick', [path, '-alpha', 'off', '-depth', '8', 'rgb:-'], { maxBuffer: 1 << 28 })
  const background = [0, 1, 2].map(c => rgb[(70 * width + 20) * 3 + c])
  const ink = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return false
    const at = (y * width + x) * 3
    return [0, 1, 2].reduce((sum, c) => sum + Math.abs(rgb[at + c] - background[c]), 0) > 60
  }
  return { width, height, ink }
}

const runs = (length, test) => {
  const found = []
  for (let i = 0; i < length; i++) {
    if (!test(i)) continue
    const start = i
    while (i + 1 < length && test(i + 1)) i++
    found.push([start, i])
  }
  return found
}

function threadColumn({ width, ink }) {
  for (let y = 60; y < 400; y++) {
    const [first] = runs(width >> 1, x => ink(x, y))
    if (first) return (first[0] + first[1] + 1) / 2
  }
  return null
}

function checkThread(shot, image) {
  const cx = threadColumn(image)
  if (cx === null) return [`FAIL ${shot}: no request rule to locate the thread column`]
  const onLine = y => [-1, 0, 1].some(d => image.ink(Math.floor(cx) + d, y))
  const onNode = y => runs(image.width, x => image.ink(x, y)).some(([a, b]) => a <= cx && b >= cx && b - a + 1 >= NODE_WIDTH && b - a + 1 <= NODE_MAX_WIDTH)
  const rowsOnLine = Array.from({ length: image.height - 100 }, (_, y) => y).filter(y => y > 60 && onLine(y))
  const threadRows = rowsOnLine.slice(rowsOnLine.findIndex((y, i) => i > 0 && y !== rowsOnLine[i - 1] + 1))
  if (rowsOnLine.length < 2 || threadRows.length < 2 || threadRows[0] === rowsOnLine[0]) return [`FAIL ${shot}: nothing is drawn on the thread column x=${cx} below the request`]
  const [top, bottom] = [threadRows[0], threadRows.at(-1)]
  const coverage = threadRows.length / (bottom - top + 1)
  const blobs = runs(image.height, y => y >= top && onNode(y))
  const last = blobs.at(-1)
  const lines = []
  lines.push(`${coverage >= MIN_COVERAGE && bottom - top > 100 ? 'ok  ' : 'FAIL'} ${shot}: thread line covers ${(coverage * 100).toFixed(0)}% of rows ${top}-${bottom} at x=${cx}`)
  lines.push(`${blobs.length >= MIN_NODES[shot] ? 'ok  ' : 'FAIL'} ${shot}: ${blobs.length} node blobs on the thread, at least ${MIN_NODES[shot]} expected`)
  const endsLine = last && last[1] >= bottom - 30
  lines.push(`${endsLine ? 'ok  ' : 'FAIL'} ${shot}: last blob ${last ? `at rows ${last[0]}-${last[1]}` : 'missing'}, thread ends at row ${bottom}`)
  return lines
}

function checkDiff(image) {
  const { height, ink } = image
  const cx = threadColumn(image)
  const verticalRun = x => runs(height, y => ink(x, y)).reduce((max, [a, b]) => Math.max(max, b - a + 1), 0)
  let recordX = null
  for (let x = Math.floor(cx) + 10; x < Math.floor(cx) + 80 && recordX === null; x++) if (verticalRun(x) >= 100) recordX = x
  if (recordX === null) return ['FAIL settled-expanded: no record sheet edge found']
  let barX = null
  for (let x = recordX + 3; x < recordX + 40 && barX === null; x++) if (verticalRun(x) >= 40) barX = x
  if (barX === null) return ['FAIL settled-expanded: no left edge drawn on any diff line']
  const barAt = y => [0, 1, 2].every(d => ink(barX + d, y))
  const markAt = y => runs(24, i => ink(barX + 4 + i, y)).length > 0
  const inRecord = y => runs(height, r => ink(recordX, r)).some(([a, b]) => b - a >= 100 && y >= a && y <= b)
  const nearBar = ([a, b]) => Array.from({ length: b - a + 5 }, (_, i) => a - 2 + i).some(barAt)
  const clusters = runs(height, y => markAt(y) || markAt(y + 1)).filter(([a, b]) => inRecord(a) && inRecord(b) && nearBar([a, b]))
  const plus = clusters.filter(([a, b]) => b - a + 1 >= 5).at(-1)
  const minus = clusters.find(([a, b]) => b - a + 1 <= 4 && b - a + 1 >= 1)
  if (!plus || !minus) return [`FAIL settled-expanded: found ${clusters.length} mark glyphs, need a + and a −`]
  const strip = ([a, b]) => {
    const mid = Math.round((a + b) / 2)
    return Array.from({ length: 17 }, (_, i) => (barAt(mid - 8 + i) ? '#' : '.')).join('')
  }
  const [added, removed] = [strip(plus), strip(minus)]
  return [`${added !== removed && added.includes('#') ? 'ok  ' : 'FAIL'} settled-expanded: added line edge ${added}, removed line edge ${removed}`]
}

const results = []
for (const shot of Object.keys(MIN_NODES)) {
  try {
    const image = load(join(dir, `${shot}.png`))
    results.push(...checkThread(shot, image))
    if (shot === 'settled-expanded') results.push(...checkDiff(image))
  } catch (error) {
    results.push(`FAIL ${shot}: ${error.message.split('\n')[0]}`)
  }
}
console.log(results.join('\n'))
const failed = results.some(line => line.startsWith('FAIL'))
console.log(failed ? 'FAIL' : 'PASS')
process.exit(failed ? 1 : 0)

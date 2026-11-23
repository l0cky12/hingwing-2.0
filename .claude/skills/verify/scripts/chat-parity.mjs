#!/usr/bin/env node
/**
 * "The chat looks as before" as a number. Takes two verify run directories whose shots carry the
 * same names, for example one from the build before a change and one `--chat-only` run of the build
 * with it. Counts the pixels that differ in every pair. Exits 0 only when every pair differs by 0.
 *
 *   chat-parity.mjs <before-run-dir> <after-run-dir>
 *   chat-parity.mjs --self-test          proves the tool reports a difference when there is one
 *
 * A shot missing from either side, a size mismatch, and a run with no pairs are FAIL, never a match.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const shots = dir => (existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith('.png') && !name.startsWith('compare-') && name !== 'failure.png') : [])
const size = path => execFileSync('magick', ['identify', '-format', '%wx%h', path], { encoding: 'utf8' })

/** Pixels that differ, or a string saying why the pair could not be compared. */
function differing(before, after) {
  if (!existsSync(before) || !existsSync(after)) return 'missing on one side'
  if (size(before) !== size(after)) return `sizes differ: ${size(before)} and ${size(after)}`
  const result = spawnSync('magick', ['compare', '-metric', 'AE', before, after, 'null:'], { encoding: 'utf8' })
  const count = Number.parseFloat(result.stderr.trim().split(/\s+/)[0] ?? '')
  return Number.isFinite(count) ? count : `magick compare said: ${result.stderr.trim()}`
}

function compareRuns(beforeDir, afterDir) {
  const names = [...new Set([...shots(beforeDir), ...shots(afterDir)])].sort()
  if (names.length === 0) {
    console.log(`FAIL no shots in ${beforeDir} or ${afterDir}`)
    return false
  }
  let same = true
  for (const name of names) {
    const found = differing(join(beforeDir, name), join(afterDir, name))
    console.log(`${found === 0 ? 'same' : 'DIFF'} ${name}  ${typeof found === 'number' ? `${found} pixels differ` : found}`)
    same &&= found === 0
  }
  console.log(same ? 'PASS' : 'FAIL')
  return same
}

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), 'chat-parity-'))
  const make = (name, ...draw) => {
    const out = join(dir, name)
    execFileSync('magick', ['-size', '64x48', 'xc:#E8EBE4', ...draw, out])
    return out
  }
  const base = make('base.png')
  const twin = make('twin.png')
  const dot = make('dot.png', '-fill', '#1F2A26', '-draw', 'point 10,10')
  const wide = make('wide.png', '-extent', '80x48')
  const checks = [
    ['an identical pair is 0', differing(base, twin) === 0],
    ['one changed pixel is reported', differing(base, dot) === 1],
    ['a size mismatch is not a match', typeof differing(base, wide) === 'string'],
    ['a missing shot is not a match', typeof differing(base, join(dir, 'absent.png')) === 'string'],
    ['two empty runs are not a match', compareRuns(join(dir, 'none-a'), join(dir, 'none-b')) === false]
  ]
  rmSync(dir, { recursive: true, force: true })
  for (const [name, ok] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`)
  return checks.every(([, ok]) => ok)
}

const [first, second] = process.argv.slice(2)
if (first === '--self-test') process.exit(selfTest() ? 0 : 1)
if (!first || !second) {
  console.error('usage: chat-parity.mjs <before-run-dir> <after-run-dir> | --self-test')
  process.exit(2)
}
process.exit(compareRuns(first, second) ? 0 : 1)

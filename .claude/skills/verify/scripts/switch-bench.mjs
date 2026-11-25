#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { SourceMap } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const H = join(REPO, '.claude/skills/verify/scripts/highwing-verify.mjs')
const EVIDENCE_ROOT = '/tmp/highwing-verify'
const BASE = ['--fixture', 'fixtures/errand.jsonl', '--profiles', 'fixtures/profiles/bench.json']
const PICK = ['click', 'button', '/^Bot: /']
/** A user takes a second or more to open the picker after the bots show. Work Highwing does in that second is not part of the switch. */
const THINK = ['pause', '1000']
const ATLAS_LAST = 'text:#scroll:Atlas closing note'
const BIRCH_ROW = 'text:nav.chats:Birch errand 01'
const COLD_TIMEOUT = '90000'

/**
 * Each scenario starts the window in `mode`, runs `before`, then times one click with the `timed` step.
 * `latencies` and `runs` override the bench's own for a scenario too slow to repeat.
 */
const SCENARIOS = {
  'mode-to-chats': { mode: 'bots', before: ['click', 'button', 'Bots'], timed: ['menuitemradio', 'Chats', 'visible:nav.chats .chat-row'] },
  'mode-to-bots': { mode: 'chats', before: ['click', 'button', 'Chats'], timed: ['menuitemradio', 'Bots', 'visible:aside.bots .bot-row'] },
  'bot-first-list': { mode: 'chats', before: [...THINK, ...PICK], timed: ['menuitemradio', 'Birch', BIRCH_ROW] },
  'bot-first-thread': { mode: 'chats', before: [...THINK, ...PICK], timed: ['menuitemradio', 'Atlas', ATLAS_LAST] },
  'bot-first-name': { mode: 'chats', before: [...THINK, ...PICK], timed: ['menuitemradio', 'Cedar', 'text:.bot-pick-button:Cedar'] },
  'bot-return-list': {
    mode: 'chats',
    before: [...PICK, 'click', 'menuitemradio', 'Birch', 'see', 'Birch errand 01', ...PICK, 'click', 'menuitemradio', 'Cedar', 'see', 'Cedar task 1', ...PICK],
    timed: ['menuitemradio', 'Birch', BIRCH_ROW]
  },
  'bot-return-thread': {
    mode: 'chats',
    before: [...PICK, 'click', 'menuitemradio', 'Atlas', 'said', 'Atlas closing note', ...PICK, 'click', 'menuitemradio', 'Birch', 'said', 'Birch noted', ...PICK],
    timed: ['menuitemradio', 'Atlas', ATLAS_LAST]
  },
  'bot-return-cold-thread': {
    mode: 'chats',
    before: [
      ...PICK, 'click', 'menuitemradio', 'Atlas', 'said', 'Atlas closing note', ...PICK, 'click', 'menuitemradio', 'Birch', 'said', 'Birch noted',
      'reached', 'session.detach', '{"session_id":"bench-atlas-bot"}', '1', ...PICK
    ],
    timed: ['menuitemradio', 'Atlas', ATLAS_LAST],
    timeout: COLD_TIMEOUT,
    latencies: [75],
    runs: 3,
    note: 'waits about 60 s for main to release the Atlas chat (RETAIN_MS), so 3 runs at 75 ms only'
  }
}

const SHOT_MS = '30,90'
const PROFILED = ['mode-to-chats', 'bot-first-thread']

const fail = message => {
  console.error(`switch-bench: ${message}`)
  process.exit(1)
}

function parse(argv) {
  const options = { runs: 7, latencies: [0, 75], only: Object.keys(SCENARIOS), shots: false, profile: false, id: `bench-${new Date().toISOString().replace(/[:.]/g, '-')}` }
  for (let index = 0; index < argv.length; index++) {
    const [flag, value] = [argv[index], argv[index + 1]]
    if (flag === '--runs' && /^[1-9]\d*$/.test(value ?? '')) [options.runs, index] = [Number(value), index + 1]
    else if (flag === '--latencies' && /^\d+(,\d+)*$/.test(value ?? '')) [options.latencies, index] = [value.split(',').map(Number), index + 1]
    else if (flag === '--only' && value !== undefined) [options.only, index] = [value.split(','), index + 1]
    else if (flag === '--id' && /^[\w-]+$/.test(value ?? '')) [options.id, index] = [value, index + 1]
    else if (flag === '--shots') options.shots = true
    else if (flag === '--profile') options.profile = true
    else fail(`unknown or malformed argument ${flag}. Usage: switch-bench.mjs [--runs N] [--latencies 0,75] [--only a,b] [--id name] [--shots] [--profile] | top <file.cpuprofile> [n]`)
  }
  for (const name of options.only) if (!(name in SCENARIOS)) fail(`unknown scenario ${name}. Known: ${Object.keys(SCENARIOS).join(', ')}`)
  return options
}

/** One fresh launch with a fresh run name. Its scratch directory is removed whether it passed or not. */
function launch(run, scenario, latency, extra) {
  const { mode, before, timed, timeout } = SCENARIOS[scenario]
  const args = [
    'run', ...BASE, '--mode', mode, '--latency', String(latency), '--run', run, ...(timeout ? ['--timeout', timeout] : []), ...extra,
    'wait', 'live', 'wait', 'bots', ...before, 'timed', scenario, ...timed, 'quiet'
  ]
  const result = spawnSync(H, args, { cwd: REPO, encoding: 'utf8' })
  spawnSync(H, ['cleanup', '--run', run], { cwd: REPO, stdio: 'ignore' })
  const evidence = join(EVIDENCE_ROOT, run)
  const timings = existsSync(join(evidence, 'timings.jsonl')) ? readFileSync(join(evidence, 'timings.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)) : []
  const passed = result.status === 0 && timings.length === 1
  if (!passed) console.error(`  ${run} FAILED: ${(result.stdout + result.stderr).split('\n').filter(line => line.includes('FAIL')).join(' | ') || `exit ${result.status}`}`)
  return { run, passed, timing: timings[0] ?? null, evidence }
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function bench(options) {
  const dir = join(EVIDENCE_ROOT, options.id)
  mkdirSync(dir, { recursive: true })
  console.log(`bench ${options.id}: ${options.only.length} scenario(s), latencies ${options.latencies.join(', ')} ms, evidence in ${EVIDENCE_ROOT}/${options.id}*`)
  const rows = []
  let failures = 0
  for (const scenario of options.only) {
    const { latencies = options.latencies, runs = options.runs, note } = SCENARIOS[scenario]
    const results = new Map(latencies.map(latency => [latency, []]))
    for (let index = 1; index <= runs; index++) {
      for (const latency of latencies) {
        const result = launch(`${options.id}-${scenario}-l${latency}-${index}`, scenario, latency, [])
        if (!result.passed) failures++
        results.get(latency).push(result)
        process.stdout.write(`  ${scenario} at ${latency} ms, run ${index}/${runs}: ${result.timing?.ms ?? 'failed'}\n`)
      }
    }
    for (const [latency, done] of results) {
      const passed = done.filter(result => result.passed)
      const samples = passed.map(result => result.timing.ms)
      const [min, max] = samples.length > 0 ? [Math.min(...samples), Math.max(...samples)] : [null, null]
      rows.push({
        scenario, latencyMs: latency, median: samples.length > 0 ? median(samples) : null, min, max, n: samples.length, wanted: runs,
        samples: passed.map(result => ({ run: result.run, ms: result.timing.ms, calls: result.timing.calls })), failed: done.filter(result => !result.passed).map(result => result.run),
        ...(note ? { note } : {})
      })
    }
  }
  const table = [['scenario', 'latency', 'median', 'min', 'max', 'n'], ...rows.map(row => [row.scenario, `${row.latencyMs} ms`, `${row.median} ms`, `${row.min} ms`, `${row.max} ms`, `${row.n}/${row.wanted}${row.note ? ' *' : ''}`])]
  const widths = table[0].map((_, column) => Math.max(...table.map(line => line[column].length)))
  console.log(`\n${table.map(line => line.map((cell, column) => cell.padEnd(widths[column])).join('  ')).join('\n')}`)
  for (const row of rows.filter(each => each.note)) console.log(`* ${row.scenario}: ${row.note}`)
  writeFileSync(join(dir, 'bench.json'), `${JSON.stringify({ id: options.id, runs: options.runs, latencies: options.latencies, rows }, null, 1)}\n`)
  console.log(`\nwrote ${join(dir, 'bench.json')}`)
  const short = rows.filter(row => row.n < row.wanted)
  if (failures > 0 || short.length > 0) fail(`${failures} run(s) failed, ${short.length} scenario(s) short of their runs`)
}

/** Not counted: a screenshot during the timed click perturbs it. These show what the window draws mid-switch. */
function shots(options) {
  const latency = 75
  let failures = 0
  for (const scenario of options.only.filter(name => name.startsWith('bot-'))) {
    const result = launch(`${options.id}-${scenario}`, scenario, latency, ['--timed-shot', SHOT_MS])
    if (!result.passed) failures++
    for (const at of SHOT_MS.split(',')) console.log(`${join(result.evidence, `${scenario}-at-${at}ms.png`)}`)
  }
  if (failures > 0) fail(`${failures} screenshot run(s) failed`)
}

/** Not counted: profiling slows the window. One run each of the profiled scenarios at 0 ms, then the top functions of each profile. */
function profile(options) {
  for (const scenario of PROFILED.filter(name => options.only.includes(name))) {
    const result = launch(`${options.id}-${scenario}`, scenario, 0, ['--cpu-profile'])
    if (!result.passed) fail(`the profile run of ${scenario} failed`)
    console.log(`\n${scenario}: ${result.timing.ms} ms while profiled`)
    for (const side of ['renderer', 'main']) top(join(result.evidence, `${scenario}.${side}.cpuprofile`), 12)
  }
}

const maps = new Map()
function origin(url, line, column) {
  if (!url.startsWith('file://')) return null
  const file = fileURLToPath(url)
  if (!maps.has(file)) maps.set(file, existsSync(`${file}.map`) ? new SourceMap(JSON.parse(readFileSync(`${file}.map`, 'utf8'))) : null)
  const entry = maps.get(file)?.findEntry(line, column)
  if (!entry?.originalSource) return null
  const source = entry.originalSource.startsWith('file://') ? fileURLToPath(entry.originalSource) : resolve(dirname(file), entry.originalSource)
  return `${relative(REPO, source)}:${entry.originalLine + 1}`
}

/** Self time per function, with the source file and line a build's source map gives it. */
function top(file, n = 15) {
  const { nodes, samples, timeDeltas } = JSON.parse(readFileSync(file, 'utf8'))
  const byId = new Map(nodes.map(node => [node.id, node]))
  const self = new Map()
  samples.forEach((id, at) => self.set(id, (self.get(id) ?? 0) + (timeDeltas[at + 1] ?? 0)))
  const total = [...self.values()].reduce((sum, us) => sum + us, 0)
  const grouped = new Map()
  for (const [id, us] of self) {
    const { functionName, url, lineNumber, columnNumber } = byId.get(id).callFrame
    const where = origin(url, lineNumber, columnNumber) ?? (url ? `${relative(REPO, url.replace(/^file:\/\//, ''))}:${lineNumber + 1}` : '')
    const key = `${functionName || '(anonymous)'} ${where}`.trim()
    grouped.set(key, (grouped.get(key) ?? 0) + us)
  }
  console.log(`${file}: ${(total / 1000).toFixed(1)} ms sampled`)
  for (const [key, us] of [...grouped].sort((a, b) => b[1] - a[1]).slice(0, Number(n))) {
    console.log(`  ${(us / 1000).toFixed(1).padStart(7)} ms ${((100 * us) / total).toFixed(1).padStart(5)}%  ${key}`)
  }
}

const [first, ...rest] = process.argv.slice(2)
if (first === 'top') {
  if (rest[0] === undefined) fail('top <file.cpuprofile> [n]')
  top(resolve(rest[0]), rest[1])
} else {
  const options = parse(process.argv.slice(2))
  if (options.shots) shots(options)
  else if (options.profile) profile(options)
  else bench(options)
}

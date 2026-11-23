#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync, openSync, readSync, closeSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const DESKTOP = join(REPO, 'apps/desktop')
const MAIN_JS = join(DESKTOP, 'out/main/index.js')
const EVIDENCE_ROOT = '/tmp/highwing-verify'
const SCRATCH_ROOT = '/tmp/highwing-verify-scratch'
const REFERENCE = join(REPO, 'docs/design/reference')
const SIZE = { width: 1180, height: 860 }
const QUIT_MS = 5_000
const requireDesktop = createRequire(join(DESKTOP, 'package.json'))

const FAKE_HOST = 'hermes-host.example-tailnet.ts.net'
const ERRAND = join(REPO, 'fixtures/errand.jsonl')
const SETTINGS_FILE = 'connection.json'

/** What `--saved` leaves in the user-data directory before launch. null: no file. */
const SAVED = {
  none: null,
  local: JSON.stringify({ version: 1, target: { kind: 'local' } }),
  remote: JSON.stringify({ version: 1, target: { kind: 'remote', host: FAKE_HOST } }),
  unreadable: '{"version": 1, "target"',
  newer: JSON.stringify({ version: 2, target: { kind: 'relay' } })
}

const STATES = {
  window: page => page.locator('#root > :not([hidden])').first(),
  setup: page => page.getByRole('button', { name: 'Connect', exact: true, disabled: false }),
  'setup-checking': page => page.getByRole('status', { name: 'Checking' }),
  'setup-failed': page => page.getByRole('alert'),
  'setup-saved': page => page.getByRole('button', { name: 'Open chat', exact: true }),
  live: page => page.getByRole('button', { name: 'Send', exact: true, disabled: false }),
  'tool-running': page => page.locator('.step[data-end="live"]').filter({ hasText: /^Running / }),
  approval: page => page.getByRole('group', { name: 'Run this command?' }).getByRole('button', { name: 'Run once', exact: true, disabled: false }),
  settled: page => page.locator('[data-end="done"]'),
  offline: page => page.getByRole('status', { name: 'Connection' })
}

const STEPS = {
  wait: { arity: 1, run: async (ctx, state) => waitFor(ctx, state) },
  see: { arity: 1, run: async (ctx, text) => ctx.page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: ctx.timeout }) },
  click: { arity: 2, run: async (ctx, role, name) => ctx.page.getByRole(role, { name, exact: true }).click({ timeout: ctx.timeout }) },
  type: { arity: 2, run: async (ctx, label, text) => ctx.page.getByLabel(label, { exact: true }).fill(expand(ctx, text), { timeout: ctx.timeout }) },
  press: { arity: 1, run: async (ctx, key) => ctx.page.keyboard.press(key) },
  shot: { arity: 1, run: async (ctx, name) => shoot(ctx, name) },
  field: {
    arity: 3,
    run: async (ctx, label, lines, outcome) => {
      if (outcome !== 'fits' && outcome !== 'scrolls') throw new Error(`field outcome must be "fits" or "scrolls", not "${outcome}"`)
      const m = await ctx.page.getByLabel(label, { exact: true }).evaluate(el => {
        const style = getComputedStyle(el)
        return {
          client: el.clientHeight,
          content: el.scrollHeight,
          lineHeight: parseFloat(style.lineHeight),
          padding: parseFloat(style.paddingTop) + parseFloat(style.paddingBottom),
          scrollbar: el.offsetWidth - el.clientWidth - parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth)
        }
      }, undefined, { timeout: ctx.timeout })
      const shown = Math.round((m.client - m.padding) / m.lineHeight)
      const scrolls = m.content > m.client + 1 && m.scrollbar > 2
      log(ctx, `  "${label}" shows ${shown} lines in ${m.client}px (content ${m.content}px, scrollbar ${m.scrollbar}px), ${scrolls ? 'scrolls' : 'fits'}`)
      if (shown !== Number(lines)) throw new Error(`"${label}" shows ${shown} lines, not ${lines}`)
      if (scrolls !== (outcome === 'scrolls')) throw new Error(`"${label}" ${scrolls ? 'scrolls' : 'fits'}, not ${outcome}`)
    }
  },
  pinned: {
    arity: 0,
    run: async ctx => {
      const m = await ctx.page.evaluate(() => {
        const scroller = document.querySelector('#scroll')
        const footer = document.querySelector('footer')
        if (!scroller || !footer) return null
        const rows = scroller.querySelectorAll('.request, .thread > *, .turn.pending > *')
        const last = rows[rows.length - 1] ?? scroller
        const view = scroller.getBoundingClientRect()
        const row = last.getBoundingClientRect()
        return {
          fromEnd: scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight,
          rowTop: row.top,
          rowBottom: row.bottom,
          viewTop: view.top,
          viewBottom: view.bottom,
          footerTop: footer.getBoundingClientRect().top
        }
      })
      if (m === null) throw new Error('no #scroll or footer on the page')
      log(ctx, `  thread ${m.fromEnd.toFixed(1)}px from its end, last row ${m.rowTop.toFixed(1)}-${m.rowBottom.toFixed(1)} in view ${m.viewTop.toFixed(1)}-${m.viewBottom.toFixed(1)}, footer top ${m.footerTop.toFixed(1)}`)
      if (m.fromEnd > 1) throw new Error(`thread is ${m.fromEnd.toFixed(1)}px short of its end`)
      const fitsInView = m.rowBottom - m.rowTop <= m.viewBottom - m.viewTop
      if (m.rowBottom > m.viewBottom + 0.5 || m.rowBottom < m.viewTop || (fitsInView && m.rowTop < m.viewTop - 0.5)) throw new Error('the last row of the thread is not in view')
      if (m.viewBottom > m.footerTop + 0.5) throw new Error('the composer covers the thread')
    }
  },
  disabled: {
    arity: 2,
    run: async (ctx, role, name) => {
      if (!(await ctx.page.getByRole(role, { name, exact: true }).isDisabled({ timeout: ctx.timeout }))) throw new Error(`${role} "${name}" is enabled`)
    }
  },
  value: {
    arity: 2,
    run: async (ctx, label, text) => {
      const held = await ctx.page.getByLabel(label, { exact: true }).inputValue({ timeout: ctx.timeout })
      if (held !== text) throw new Error(`"${label}" holds ${JSON.stringify(held)}, not ${JSON.stringify(text)}`)
    }
  },
  focused: {
    arity: 2,
    run: async (ctx, role, name) => {
      const found = ctx.page.getByRole(role, { name, exact: true })
      if (!(await found.evaluateAll(nodes => nodes.includes(document.activeElement)))) {
        const now = await ctx.page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? 'nothing')
        throw new Error(`${role} "${name}" does not have focus; "${now}" does`)
      }
    }
  },
  count: {
    arity: 3,
    run: async (ctx, role, name, n) => {
      const found = await ctx.page.getByRole(role, { name: nameMatcher(name), exact: true }).count()
      if (found !== Number(n)) throw new Error(`${found} ${role}(s) named ${name}, not ${n}`)
    }
  },
  clipboard: {
    arity: 1,
    run: async (ctx, name) => {
      const read = () => ctx.app.evaluate(({ clipboard }) => clipboard.readText())
      const deadline = Date.now() + ctx.timeout
      let text = await read()
      while (text === '' || text === ctx.clipboard) {
        if (Date.now() > deadline) throw new Error(text === '' ? 'the clipboard is empty' : 'the clipboard has not changed since the last clipboard step')
        text = await read()
      }
      ctx.clipboard = text
      writeFileSync(join(ctx.evidence, `${name}.clip.txt`), text)
      log(ctx, `  saved ${name}.clip.txt (${text.length} characters)`)
    }
  },
  marks: {
    arity: 1,
    run: async (ctx, count) => {
      const found = await ctx.page.evaluate(() => ['find', 'find-current'].reduce((total, name) => total + (CSS.highlights.get(name)?.size ?? 0), 0))
      if (found !== Number(count)) throw new Error(`${found} ranges are marked, expected ${count}`)
    }
  }
}

const nameMatcher = name => (/^\/.+\/$/.test(name) ? new RegExp(name.slice(1, -1)) : name)

const fail = message => {
  console.error(`highwing-verify: ${message}`)
  process.exit(1)
}

function parseOptions(argv, known) {
  const options = {}
  const rest = []
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (!arg.startsWith('--')) { rest.push(arg); continue }
    const [key, inline] = arg.slice(2).split(/=(.*)/s)
    if (!(key in known)) fail(`unknown option --${key}`)
    options[key] = known[key] === 'flag' ? true : inline ?? argv[++index]
  }
  return { options, rest }
}

const electronBinary = () => {
  const pathFile = join(dirname(requireDesktop.resolve('electron/package.json')), 'path.txt')
  return existsSync(pathFile) ? join(dirname(pathFile), 'dist', readFileSync(pathFile, 'utf8').trim()) : null
}

const newestMtime = dir => readdirSync(dir, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile())
  .reduce((newest, entry) => Math.max(newest, statSync(join(entry.parentPath, entry.name)).mtimeMs), 0)

const SOURCES = [join(DESKTOP, 'src'), join(REPO, 'packages/hermes/src'), join(REPO, 'packages/thread/src')]
const buildIsStale = () => !existsSync(MAIN_JS) || Math.max(...SOURCES.map(newestMtime), statSync(join(DESKTOP, 'electron.vite.config.ts')).mtimeMs) > newestMtime(join(DESKTOP, 'out'))

const tsxLoader = () => {
  try { return pathToFileURL(createRequire(join(REPO, 'package.json')).resolve('tsx')).href } catch { return null }
}

/** The pids of fake tools from `bin` that are still running. The app must leave none behind when it quits. */
const toolsRunning = bin => readdirSync('/proc').filter(entry => /^\d+$/.test(entry)).filter(pid => {
  try { return readFileSync(`/proc/${pid}/cmdline`, 'utf8').includes(bin) } catch { return false }
})

const pngSize = path => {
  const fd = openSync(path, 'r')
  const header = Buffer.alloc(24)
  readSync(fd, header, 0, 24, 0)
  closeSync(fd)
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
}

const alive = pid => {
  try { process.kill(pid, 0); return true } catch { return false }
}

const instances = () => existsSync(SCRATCH_ROOT)
  ? readdirSync(SCRATCH_ROOT).map(run => ({ run, pidFile: join(SCRATCH_ROOT, run, 'pid') }))
    .filter(({ pidFile }) => existsSync(pidFile))
    .map(({ run, pidFile }) => ({ run, pid: Number(readFileSync(pidFile, 'utf8')) }))
  : []

function doctor() {
  const checks = [
    ['node >= 22', Number(process.versions.node.split('.')[0]) >= 22, process.versions.node],
    ['xvfb-run on PATH', spawnSync('which', ['xvfb-run']).status === 0, 'needed so no window opens on the desktop'],
    ['magick on PATH', spawnSync('which', ['magick']).status === 0, 'needed by compare'],
    ['playwright-core installed', (() => { try { return Boolean(requireDesktop.resolve('playwright-core')) } catch { return false } })(), 'pnpm install'],
    ['electron binary downloaded', Boolean(electronBinary()) && existsSync(electronBinary()), electronBinary() ?? 'run: node -e "require(\'electron\')" in apps/desktop'],
    ['build present and newer than sources', !buildIsStale(), 'run: highwing-verify.mjs build'],
    ['tsx installed', Boolean(tsxLoader()), 'needed to run the fake host; pnpm install']
  ]
  for (const [name, ok, detail] of checks) console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `  (${detail})`}`)
  const running = instances().filter(({ pid }) => alive(pid))
  console.log(running.length === 0 ? 'ok   no verify instance running' : `note ${running.length} verify instance(s) running: ${running.map(({ run, pid }) => `${run} pid ${pid}`).join(', ')}`)
  process.exit(checks.every(([, ok]) => ok) ? 0 : 1)
}

function build() {
  const result = spawnSync('pnpm', ['--filter', '@highwing/desktop', 'build'], { cwd: REPO, stdio: 'inherit' })
  process.exit(result.status ?? 1)
}

function requestText(fixturePath) {
  for (const line of readFileSync(fixturePath, 'utf8').split('\n').slice(1)) {
    if (!line.trim()) continue
    const step = JSON.parse(line)
    if (step.await === 'prompt.submit') return step.params.text
  }
  fail(`${fixturePath} has no prompt.submit step, so @request means nothing`)
}

const expand = (ctx, text) => (text === '@request' ? requestText(ctx.fixture ?? fail('@request needs --fixture')) : text)

function log(ctx, line) {
  const stamped = `${new Date().toISOString()} ${line}`
  console.log(stamped)
  appendFileSync(join(ctx.evidence, 'steps.log'), `${stamped}\n`)
}

/** Polls without backoff: Playwright's own `waitFor` spaces polls up to 500 ms apart and misses brief states. */
async function waitFor(ctx, state) {
  const locate = STATES[state] ?? fail(`unknown state "${state}". Known: ${Object.keys(STATES).join(', ')}`)
  const locator = locate(ctx.page)
  const deadline = Date.now() + ctx.timeout
  while (!(await locator.isVisible())) {
    if (Date.now() > deadline) throw new Error(`state "${state}" did not appear within ${ctx.timeout} ms`)
  }
  ctx.holding = state
}

async function shoot(ctx, name) {
  const path = join(ctx.evidence, `${name}.png`)
  await ctx.page.mouse.move(0, 0)
  await ctx.page.screenshot({ path, animations: 'disabled', caret: 'hide' })
  writeFileSync(join(ctx.evidence, `${name}.aria.txt`), await ctx.page.locator('body').ariaSnapshot())
  const size = pngSize(path)
  if (size.width !== SIZE.width || size.height !== SIZE.height) throw new Error(`${name}.png is ${size.width}x${size.height}, not ${SIZE.width}x${SIZE.height}`)
  if (ctx.holding && !(await STATES[ctx.holding](ctx.page).isVisible())) {
    throw new Error(`state "${ctx.holding}" ended before ${name}.png was taken, so the shot may show a later moment`)
  }
  log(ctx, `  saved ${path} (state "${ctx.holding ?? 'none'}" still held)`)
}

function parseSteps(words) {
  const steps = []
  for (let index = 0; index < words.length;) {
    const verb = words[index]
    const step = STEPS[verb] ?? fail(`unknown step "${verb}". Known: ${Object.keys(STEPS).join(', ')}`)
    const args = words.slice(index + 1, index + 1 + step.arity)
    if (args.length < step.arity) fail(`"${verb}" needs ${step.arity} argument(s)`)
    steps.push({ verb, args })
    index += 1 + step.arity
  }
  return steps
}

/** The X server on our display must be the one our own xvfb-run started, or a teardown elsewhere kills this run. */
function ownDisplay() {
  const number = (process.env.DISPLAY ?? '').replace(/^:/, '').split('.')[0]
  const lock = `/tmp/.X${number}-lock`
  const server = existsSync(lock) ? Number(readFileSync(lock, 'utf8').trim()) : NaN
  const parent = existsSync(`/proc/${server}/stat`) ? Number(readFileSync(`/proc/${server}/stat`, 'utf8').split(') ')[1]?.split(' ')[1]) : NaN
  if (parent !== process.ppid) fail(`display ${process.env.DISPLAY} belongs to another run's X server. Start this run again.`)
}

function withDrop(fixturePath, type, out) {
  const lines = readFileSync(fixturePath, 'utf8').split('\n').filter(line => line.trim() !== '')
  const steps = lines.slice(1).map(line => JSON.parse(line))
  const at = steps.findIndex(step => step.push?.params?.type === type)
  if (at === -1) fail(`${fixturePath} pushes no ${type} frame`)
  const dropAt = Math.min(steps[at].at + 50, steps[at + 1]?.at ?? Infinity)
  steps.splice(at + 1, 0, { at: dropAt, drop: 1006 })
  writeFileSync(out, [lines[0], ...steps.map(step => JSON.stringify(step))].join('\n') + '\n')
  return out
}

/**
 * Starts the fake Hermes machine in its own process and resolves with the bin directory of its fake
 * ssh, tailscale and hermes. The app is then launched with that directory as its whole PATH, so it
 * cannot reach the real ones.
 */
function startFakeHost(scenario, fixture, holdAt, scratch) {
  const child = spawn(process.execPath, ['--import', tsxLoader() ?? fail('tsx is missing; run doctor'), join(REPO, 'scripts/fake-host.ts'), scenario, fixture, ...(holdAt ? [holdAt] : [])], {
    cwd: REPO, stdio: ['ignore', 'pipe', 'inherit']
  })
  writeFileSync(join(scratch, 'host-pid'), String(child.pid))
  return new Promise(resolve => {
    let text = ''
    child.stdout.on('data', chunk => {
      text += chunk
      if (text.includes('\n')) resolve({ child, bin: JSON.parse(text).bin })
    })
    child.on('exit', code => fail(`the fake host exited with code ${code} before the run ended`))
  })
}

async function run(argv) {
  ownDisplay()
  const { options, rest } = parseOptions(argv, { fixture: 'value', run: 'value', timeout: 'value', 'drop-after': 'value', 'fake-host': 'value', 'hold-at': 'value', saved: 'value' })
  const steps = parseSteps(rest)
  const scenario = options['fake-host']
  if (!options.fixture && !scenario) fail('pass --fixture <path> to replay a recorded gateway, or --fake-host <scenario> to launch against the fake Hermes machine')
  if (!scenario && (options.saved || options['hold-at'])) fail('--saved and --hold-at need --fake-host: without it the app would run the real ssh, tailscale and hermes')
  if (scenario && options['drop-after']) fail('--drop-after edits the fixture a --fixture run replays. It does nothing with --fake-host')
  if (options.saved && !(options.saved in SAVED)) fail(`unknown --saved "${options.saved}". Known: ${Object.keys(SAVED).join(', ')}`)
  if (buildIsStale()) fail('the build is missing or older than the sources. Run: highwing-verify.mjs build')
  const runId = options.run ?? `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`
  const evidence = join(EVIDENCE_ROOT, runId)
  const scratch = join(SCRATCH_ROOT, runId)
  mkdirSync(evidence, { recursive: true })
  mkdirSync(scratch, { recursive: true })
  const given = options.fixture ? resolve(process.cwd(), options.fixture) : scenario ? ERRAND : null
  const fixture = options['drop-after'] ? withDrop(given, options['drop-after'], join(evidence, 'fixture-with-drop.jsonl')) : given
  const ctx = { app: null, page: null, evidence, fixture, timeout: Number(options.timeout ?? 15_000), holding: null, clipboard: null }

  const userData = join(scratch, 'user-data')
  const saved = SAVED[options.saved ?? 'none']
  if (scenario) {
    rmSync(userData, { recursive: true, force: true })
    mkdirSync(userData, { recursive: true })
    if (saved !== null) writeFileSync(join(userData, SETTINGS_FILE), saved)
    // The check of this scenario passes. The save after it fails, because its temp file cannot be opened.
    if (scenario === 'cant-save') mkdirSync(join(userData, `${SETTINGS_FILE}.tmp`))
  }
  const host = scenario ? await startFakeHost(scenario, fixture, options['hold-at'], scratch) : null

  const env = { ...process.env, ...(host ? { PATH: host.bin } : {}) }
  delete env.WAYLAND_DISPLAY
  delete env.ELECTRON_RENDERER_URL
  delete env.HIGHWING_FIXTURE
  delete env.HIGHWING_RECORD
  if (!host) env.HIGHWING_FIXTURE = fixture

  const { _electron } = requireDesktop('playwright-core')
  log(ctx, `run ${runId}: launching on ${process.env.DISPLAY} with ${host ? `the fake host "${scenario}" as the whole PATH, saved connection "${options.saved ?? 'none'}"` : `HIGHWING_FIXTURE=${fixture}`}`)
  const app = await _electron.launch({
    executablePath: electronBinary() ?? fail('electron binary missing; run doctor'),
    args: [MAIN_JS, '--ozone-platform=x11', '--force-device-scale-factor=1', '--disable-gpu', `--user-data-dir=${userData}`],
    cwd: REPO,
    env,
    timeout: ctx.timeout
  }).catch(error => {
    log(ctx, `FAILED to launch: ${error.message.split('\n')[0]}`)
    log(ctx, `FAIL evidence in ${evidence}`)
    process.exit(1)
  })
  ctx.app = app
  const pid = app.process().pid
  writeFileSync(join(scratch, 'pid'), String(pid))
  const mainLog = join(evidence, 'main.log')
  app.process().stdout?.on('data', chunk => appendFileSync(mainLog, chunk))
  app.process().stderr?.on('data', chunk => appendFileSync(mainLog, chunk))
  let failed = null
  try {
    ctx.page = await app.firstWindow({ timeout: ctx.timeout })
    ctx.page.on('console', message => appendFileSync(join(evidence, 'console.log'), `${message.type()} ${message.text()}\n`))
    ctx.page.on('pageerror', error => appendFileSync(join(evidence, 'console.log'), `pageerror ${error.stack ?? error}\n`))
    await ctx.page.waitForLoadState('domcontentloaded')
    for (const { verb, args } of steps) {
      log(ctx, `${verb} ${args.map(arg => JSON.stringify(arg)).join(' ')}`)
      if (verb !== 'shot' && verb !== 'wait') ctx.holding = null
      await STEPS[verb].run(ctx, ...args)
    }
  } catch (error) {
    failed = error
    log(ctx, `FAILED: ${error.message.split('\n')[0]}`)
    await ctx.page?.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {})
  } finally {
    // A tool the app left running holds the app's pipes open, and close() would then wait on it for ever.
    await Promise.race([app.close().catch(() => {}), new Promise(done => setTimeout(done, QUIT_MS))])
    if (alive(pid)) process.kill(pid, 'SIGKILL')
    rmSync(join(scratch, 'pid'), { force: true })
    if (host) {
      const deadline = Date.now() + QUIT_MS
      while (toolsRunning(host.bin).length > 0 && Date.now() < deadline) await new Promise(done => setTimeout(done, 50))
      const left = toolsRunning(host.bin)
      if (left.length > 0 && !failed) {
        failed = new Error(`the app quit and left ${left.length} ssh, tailscale or hermes process(es) running: pid ${left.join(', ')}`)
        log(ctx, `FAILED: ${failed.message}`)
      }
      host.child.removeAllListeners('exit')
      host.child.kill()
      rmSync(join(scratch, 'host-pid'), { force: true })
    }
  }
  log(ctx, `${failed ? 'FAIL' : 'PASS'} evidence in ${evidence}`)
  process.exit(failed ? 1 : 0)
}

const REFERENCES = {
  'tool-running': 'tool-running-C.png',
  approval: 'approval-C.png',
  settled: 'settled-C.png',
  'settled-expanded': 'settled-C-expanded.png'
}

function compare(argv) {
  const [runId] = argv
  if (!runId) fail('compare <run>')
  const evidence = join(EVIDENCE_ROOT, runId)
  const shots = Object.keys(REFERENCES).filter(name => existsSync(join(evidence, `${name}.png`)))
  if (shots.length === 0) fail(`no shot in ${evidence} is named ${Object.keys(REFERENCES).join(', ')}`)
  for (const name of shots) {
    const out = join(evidence, `compare-${name}.png`)
    const result = spawnSync('magick', [join(REFERENCE, REFERENCES[name]), join(evidence, `${name}.png`), '+append', out], { stdio: 'inherit' })
    if (result.status !== 0) fail(`magick failed for ${name}`)
    console.log(out)
  }
}

function cleanup(argv) {
  const { options } = parseOptions(argv, { run: 'value', all: 'flag' })
  if (!options.run && !options.all) fail('cleanup --run <run> or cleanup --all')
  const targets = options.all ? (existsSync(SCRATCH_ROOT) ? readdirSync(SCRATCH_ROOT) : []) : [options.run]
  for (const runId of targets) {
    const scratch = join(SCRATCH_ROOT, runId)
    for (const pidFile of [join(scratch, 'pid'), join(scratch, 'host-pid')]) {
      if (!existsSync(pidFile)) continue
      const pid = Number(readFileSync(pidFile, 'utf8'))
      if (alive(pid)) process.kill(pid, 'SIGKILL')
      console.log(`stopped ${runId} pid ${pid}`)
    }
    if (!resolve(scratch).startsWith(`${SCRATCH_ROOT}/`)) fail(`refusing to remove ${scratch}`)
    rmSync(scratch, { recursive: true, force: true })
    console.log(`removed ${scratch}`)
  }
}

function underXvfb(argv) {
  const firstDisplay = String(100 + (process.pid % 800))
  const child = spawn('xvfb-run', ['-n', firstDisplay, '-a', '-s', '-screen 0 1600x1200x24', process.execPath, fileURLToPath(import.meta.url), ...argv], {
    stdio: 'inherit', env: { ...process.env, HIGHWING_VERIFY_XVFB: '1' }
  })
  child.on('exit', code => process.exit(code ?? 1))
}

const [command, ...argv] = process.argv.slice(2)
const COMMANDS = {
  doctor,
  build,
  run: () => (process.env.HIGHWING_VERIFY_XVFB === '1' ? run(argv) : underXvfb(['run', ...argv])),
  compare: () => compare(argv),
  cleanup: () => cleanup(argv)
}
;(COMMANDS[command] ?? (() => fail(`usage: highwing-verify.mjs <${Object.keys(COMMANDS).join('|')}> ...`)))()

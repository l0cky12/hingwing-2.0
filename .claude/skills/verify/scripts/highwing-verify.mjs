#!/usr/bin/env node
// Drives the Highwing desktop app through Playwright's Electron driver, inside a private Xvfb display.
// Usage: highwing-verify.mjs <doctor|build|run|compare|cleanup> ...   (see ../SKILL.md)
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync, openSync, readSync, closeSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const DESKTOP = join(REPO, 'apps/desktop')
const MAIN_JS = join(DESKTOP, 'out/main/index.js')
const EVIDENCE_ROOT = '/tmp/highwing-verify'
const SCRATCH_ROOT = '/tmp/highwing-verify-scratch'
const REFERENCE = join(REPO, 'docs/design/reference')
const SIZE = { width: 1180, height: 860 }
const requireDesktop = createRequire(join(DESKTOP, 'package.json'))

/** Named states: a locator that is visible exactly while the app is in that state. */
const STATES = {
  window: page => page.locator('#root > *').first(),
  live: page => page.getByRole('button', { name: 'Send', exact: true, disabled: false }),
  'tool-running': page => page.locator('.step[data-end="live"]').filter({ hasText: /^Running / }),
  approval: page => page.getByRole('group', { name: 'Run this command?' }).getByRole('button', { name: 'Run once', exact: true, disabled: false }),
  settled: page => page.locator('[data-end="done"]'),
  offline: page => page.getByRole('status', { name: 'Connection' })
}

/** Steps a `run` takes, with how many arguments each consumes. */
const STEPS = {
  wait: { arity: 1, run: async (ctx, state) => waitFor(ctx, state) },
  see: { arity: 1, run: async (ctx, text) => ctx.page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout: ctx.timeout }) },
  click: { arity: 2, run: async (ctx, role, name) => ctx.page.getByRole(role, { name, exact: true }).click({ timeout: ctx.timeout }) },
  type: { arity: 2, run: async (ctx, label, text) => ctx.page.getByLabel(label, { exact: true }).fill(expand(ctx, text), { timeout: ctx.timeout }) },
  press: { arity: 1, run: async (ctx, key) => ctx.page.keyboard.press(key) },
  shot: { arity: 1, run: async (ctx, name) => shoot(ctx, name) },
  disabled: {
    arity: 2,
    run: async (ctx, role, name) => {
      if (!(await ctx.page.getByRole(role, { name, exact: true }).isDisabled({ timeout: ctx.timeout }))) throw new Error(`${role} "${name}" is enabled`)
    }
  }
}

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

/** PATH without any directory holding a `hermes` executable, so a no-fixture launch cannot reach the real gateway. */
const pathWithoutHermes = () => (process.env.PATH ?? '').split(delimiter).filter(dir => !existsSync(join(dir, 'hermes'))).join(delimiter)

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
    ['no-fixture launch cannot see hermes', spawnSync('sh', ['-c', 'command -v hermes'], { env: { ...process.env, PATH: pathWithoutHermes() } }).status !== 0, 'PATH filter']
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

/** Text the fixture's first `await prompt.submit` step recorded, for `type <label> @request`. */
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

/**
 * Verification scaffolding: a copy of the fixture whose gateway closes the socket right after the
 * first frame of event type `type`. The client then shows the dropped link until its redial lands.
 */
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

async function run(argv) {
  ownDisplay()
  const { options, rest } = parseOptions(argv, { fixture: 'value', run: 'value', timeout: 'value', 'drop-after': 'value', 'no-fixture': 'flag' })
  const steps = parseSteps(rest)
  if (!options.fixture && !options['no-fixture']) fail('pass --fixture <path>, or --no-fixture to launch against no gateway')
  if (buildIsStale()) fail('the build is missing or older than the sources. Run: highwing-verify.mjs build')
  const runId = options.run ?? `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`
  const evidence = join(EVIDENCE_ROOT, runId)
  const scratch = join(SCRATCH_ROOT, runId)
  mkdirSync(evidence, { recursive: true })
  mkdirSync(scratch, { recursive: true })
  const given = options.fixture ? resolve(process.cwd(), options.fixture) : null
  const fixture = given && options['drop-after'] ? withDrop(given, options['drop-after'], join(evidence, 'fixture-with-drop.jsonl')) : given
  const ctx = { page: null, evidence, fixture, timeout: Number(options.timeout ?? 15_000), holding: null }

  const env = { ...process.env, PATH: fixture ? process.env.PATH : pathWithoutHermes() }
  delete env.WAYLAND_DISPLAY
  delete env.ELECTRON_RENDERER_URL
  delete env.HIGHWING_FIXTURE
  if (fixture) env.HIGHWING_FIXTURE = fixture

  const { _electron } = requireDesktop('playwright-core')
  log(ctx, `run ${runId}: launching on ${process.env.DISPLAY} with ${fixture ? `HIGHWING_FIXTURE=${fixture}` : 'no fixture, hermes removed from PATH'}`)
  const app = await _electron.launch({
    executablePath: electronBinary() ?? fail('electron binary missing; run doctor'),
    args: [MAIN_JS, '--ozone-platform=x11', '--force-device-scale-factor=1', '--disable-gpu', `--user-data-dir=${join(scratch, 'user-data')}`],
    cwd: REPO,
    env,
    timeout: ctx.timeout
  }).catch(error => {
    log(ctx, `FAILED to launch: ${error.message.split('\n')[0]}`)
    log(ctx, `FAIL evidence in ${evidence}`)
    process.exit(1)
  })
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
    await app.close().catch(() => {})
    if (alive(pid)) process.kill(pid, 'SIGKILL')
    rmSync(join(scratch, 'pid'), { force: true })
  }
  log(ctx, `${failed ? 'FAIL' : 'PASS'} evidence in ${evidence}`)
  process.exit(failed ? 1 : 0)
}

/** The design C reference each shot name is compared with, from docs/design/reference/. */
const REFERENCES = {
  'tool-running': 'tool-running-C.png',
  approval: 'approval-C.png',
  settled: 'settled-C.png',
  'settled-expanded': 'settled-C-expanded.png'
}

/** Side-by-side composites, the reference on the left, for every shot named in `REFERENCES`. */
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

/** Stops instances this skill started and removes their scratch state. Evidence under /tmp/highwing-verify is never touched. */
function cleanup(argv) {
  const { options } = parseOptions(argv, { run: 'value', all: 'flag' })
  if (!options.run && !options.all) fail('cleanup --run <run> or cleanup --all')
  const targets = options.all ? (existsSync(SCRATCH_ROOT) ? readdirSync(SCRATCH_ROOT) : []) : [options.run]
  for (const runId of targets) {
    const scratch = join(SCRATCH_ROOT, runId)
    const pidFile = join(scratch, 'pid')
    if (existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, 'utf8'))
      if (alive(pid)) process.kill(pid, 'SIGKILL')
      console.log(`stopped ${runId} pid ${pid}`)
    }
    if (!resolve(scratch).startsWith(`${SCRATCH_ROOT}/`)) fail(`refusing to remove ${scratch}`)
    rmSync(scratch, { recursive: true, force: true })
    console.log(`removed ${scratch}`)
  }
}

/**
 * Re-enter under a private X server so the window never reaches the user's compositor. `xvfb-run -a`
 * alone hands two runs started together the same display, so each run starts its search at its own number.
 */
function underXvfb(argv) {
  const firstDisplay = String(100 + (process.pid % 800))
  const child = spawn('xvfb-run', ['-a', '-n', firstDisplay, '-s', '-screen 0 1600x1200x24', process.execPath, fileURLToPath(import.meta.url), ...argv], {
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

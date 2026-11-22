// Throwaway prototype. Modes:
//   electron39 .                                   interactive, live gateway
//   electron39 . --auto "<prompt>" --record f --shots dir   live run, record events, screenshot
//   electron39 . --replay f --shots dir            replay a recording, screenshot
const { app, BrowserWindow, ipcMain } = require('electron')
const { execFile } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const argv = process.argv.slice(2)
const flag = name => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const AUTO = flag('--auto')
const RECORD = flag('--record')
const REPLAY = flag('--replay')
const SHOTS = flag('--shots')
const WORKDIR = '/tmp/hermes-proto-work'
const headless = Boolean(SHOTS)

let win
let ws
let sessionId
let nextId = 1
const pending = new Map()
const t0 = Date.now()
const log = (...a) => console.log('[proto]', ...a)

function record(frame) {
  if (RECORD) fs.appendFileSync(RECORD, JSON.stringify({ t: Date.now() - t0, frame }) + '\n')
}

let toRendererHook = null
function toRenderer(frame) {
  record(frame)
  win.webContents.send('frame', frame)
  if (toRendererHook) toRendererHook(frame)
}

function call(method, params) {
  const id = `proto-${nextId++}`
  ws.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject, method }))
}

function attach() {
  return new Promise((resolve, reject) =>
    execFile('hermes', ['gateway', 'attach', '--json'], { timeout: 60_000 }, (err, stdout) => {
      if (err) return reject(err)
      resolve(JSON.parse(stdout))
    })
  )
}

async function connectLive() {
  const a = await attach()
  if (!a.url) throw new Error(`gateway not attachable: ${a.state} ${a.reason_code}`)
  ws = new WebSocket(a.url, a.protocols)
  ws.onmessage = ev => {
    const frame = JSON.parse(ev.data)
    if (frame.id && pending.has(frame.id) && !frame.method) {
      const p = pending.get(frame.id)
      pending.delete(frame.id)
      frame.error ? p.reject(new Error(`${p.method}: ${JSON.stringify(frame.error)}`)) : p.resolve(frame.result)
      return
    }
    if (frame.method === 'event') return toRenderer({ kind: 'event', ...frame.params })
    if (frame.method && frame.id) return toRenderer({ kind: 'request', id: frame.id, method: frame.method, params: frame.params })
  }
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('websocket error'))
  })
  log('connected, subprotocol', ws.protocol)
  await call('client.capabilities', { server_requests: true })
  fs.mkdirSync(path.join(WORKDIR, 'scratch'), { recursive: true })
  const created = await call('session.create', { cwd: WORKDIR, cwd_explicit: true, title: 'UI prototype recording' })
  sessionId = created.session_id
  log('session', sessionId)
  toRenderer({ kind: 'local', type: 'session', session_id: sessionId })
}

ipcMain.handle('submit', async (_e, text) => {
  toRenderer({ kind: 'local', type: 'user', text })
  return call('prompt.submit', { session_id: sessionId, input_id: randomUUID(), text })
})

const respondCanonical = (promptId, generation, choice) =>
  call('approval.respond', { session_id: sessionId, prompt_id: promptId, execution_generation: generation, choice })

ipcMain.handle('approve', async (_e, { requestId, rpcId, generation, choice }) => {
  if (rpcId) ws.send(JSON.stringify({ jsonrpc: '2.0', id: rpcId, result: { choice } }))
  else await respondCanonical(requestId, generation, choice)
  toRenderer({ kind: 'local', type: 'approval.answered', request_id: requestId, choice })
})

const sleep = ms => new Promise(r => setTimeout(r, ms))
const js = code => win.webContents.executeJavaScript(code)

async function shoot(name) {
  await sleep(250)
  const img = await win.webContents.capturePage()
  const file = path.join(SHOTS, `${name}.png`)
  fs.writeFileSync(file, img.toPNG())
  log('shot', file, img.getSize())
}

async function shootAllVariants(moment) {
  for (const v of ['A', 'B', 'C']) {
    await js(`proto.setVariant('${v}')`)
    await shoot(`${moment}-${v}`)
  }
}

// Moments worth a screenshot, chosen while frames stream in.
function momentFor(frame, seen) {
  if (frame.kind === 'event' && frame.type === 'tool.start' && frame.payload?.name === 'terminal') return 'tool-running'
  if ((frame.kind === 'request' && frame.method === 'approval') || (frame.kind === 'event' && frame.type === 'approval.request')) return 'approval'
  return null
}

async function replay() {
  const lines = fs.readFileSync(REPLAY, 'utf8').trim().split('\n').map(l => JSON.parse(l))
  const seen = new Set()
  let last = 0
  for (const { t, frame } of lines) {
    if (!SHOTS) await sleep(Math.min(t - last, 900) + 120)
    last = t
    win.webContents.send('frame', frame)
    const m = momentFor(frame, seen)
    if (SHOTS && m && !seen.has(m)) {
      seen.add(m)
      await sleep(100)
      await shootAllVariants(m)
    }
  }
  if (!SHOTS) return
  await sleep(300)
  await shootAllVariants('settled')
  await js(`proto.setVariant('B'); proto.expandAll()`)
  await shoot('settled-B-expanded')
  await js(`document.getElementById('scroll').scrollTop = 0`)
  await shoot('settled-B-expanded-top')
  await js(`proto.setVariant('C'); proto.expandAll()`)
  await shoot('settled-C-expanded')
}

async function autoRun() {
  await connectLive()
  const done = new Promise(resolve => {
    toRendererHook = async frame => {
      if (frame.kind === 'request' && frame.method === 'approval') {
        log('approval requested:', frame.params.command)
        await sleep(400)
        await shootAllVariants('approval-live')
        await js('proto.setVariant("A")')
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { choice: 'once' } }))
        toRenderer({ kind: 'local', type: 'approval.answered', request_id: frame.params.request_id, choice: 'once' })
      }
      if (frame.kind === 'event' && frame.type === 'approval.request' && frame.payload?.kind !== 'clarify') {
        log('approval event:', frame.payload?.command)
        await sleep(400)
        await shootAllVariants('approval-live')
        const p = frame.payload
        await respondCanonical(p.prompt_id ?? p.request_id, frame.execution_generation ?? p.execution_generation, 'once')
        toRenderer({ kind: 'local', type: 'approval.answered', request_id: p.prompt_id ?? p.request_id, choice: 'once' })
      }
      if (frame.kind === 'event' && frame.type === 'message.complete') resolve()
    }
  })
  await js(`proto.submit(${JSON.stringify(AUTO)})`)
  const timeout = sleep(240_000).then(() => log('timed out waiting for message.complete'))
  await Promise.race([done, timeout])
  await sleep(500)
  await shootAllVariants('live-settled')
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1180,
    height: 860,
    show: !headless,
    title: 'Hermes chat prototype',
    backgroundColor: '#0f1115',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), offscreen: headless }
  })
  await win.loadFile('index.html')
  if (headless) await win.webContents.executeJavaScript('window.__freezeMark = true')
  try {
    if (REPLAY) {
      if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
      await replay()
      if (SHOTS) app.quit()
    } else if (AUTO) {
      if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
      if (RECORD) fs.writeFileSync(RECORD, '')
      await autoRun()
      ws.close()
      app.quit()
    } else {
      await connectLive()
    }
  } catch (err) {
    console.error('[proto] failed', err)
    app.exit(1)
  }
})

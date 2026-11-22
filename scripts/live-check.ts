import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Link, Session, Sidebar } from '../packages/hermes/src/domain'
import { liveDialer, openHermes } from '../packages/hermes/src/hub'
import { recordingDialer } from '../packages/hermes/src/testing/fixture'
import { outline, threadView } from '../packages/thread/src/thread-view'

const TIMEOUT_MS = 30_000
const MESSAGE = 'Reply with the single word: hello'
const record = process.argv[2]
const diagnostics = new Map<string, number>()
const started = Date.now()
const say = (line: string) => console.log(`${((Date.now() - started) / 1000).toFixed(2)}s ${line}`)

const hermes = openHermes({
  dial: record ? recordingDialer(liveDialer(), record) : liveDialer(),
  startGatewayOnLaunch: false,
  client: { name: 'highwing-live-check', version: '0.0.0' },
  onDiagnostic: ({ kind, type }) => diagnostics.set(`${kind}:${type}`, (diagnostics.get(`${kind}:${type}`) ?? 0) + 1)
})

interface Watchable<V> { subscribe(listener: (value: V) => void): () => void }

/** Settles on the first value `judge` decides on, the current one included, or rejects after TIMEOUT_MS. */
function until<V, T>(what: string, source: Watchable<V> & { get?(): V }, judge: (value: V, done: (result: T) => void, stop: (reason: string) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let over = false
    const end = (settle: () => void) => {
      if (over) return
      over = true
      clearTimeout(timer)
      queueMicrotask(() => off())
      settle()
    }
    const done = (result: T) => end(() => resolve(result))
    const stop = (reason: string) => end(() => reject(new Error(reason)))
    const timer = setTimeout(() => stop(`timed out after ${TIMEOUT_MS / 1000}s waiting for ${what}`), TIMEOUT_MS)
    const off = source.subscribe(value => judge(value, done, stop))
    if (source.get) judge(source.get(), done, stop)
  })
}

async function check(): Promise<void> {
  await until<Link, void>('the link to come online', hermes.link, (link, done, stop) => {
    if (link.state === 'online') done()
    if (link.state === 'blocked') stop(`link refused: ${link.message}`)
  })
  say('link online')

  const rows = await until<Sidebar, number>('the sidebar listing', hermes.sidebar, (sidebar, done) => {
    if (sidebar.status === 'ready') done(sidebar.rows.length)
  })
  say(`listed ${rows} chats`)

  const cwd = mkdtempSync(join(tmpdir(), 'highwing-live-check-'))
  const created = await hermes.run({ do: 'create', draftId: crypto.randomUUID(), cwd })
  if (!created.ok) throw new Error(`create refused: ${created.refusal.message}`)
  say(`created chat ${created.value} in ${cwd}`)

  let sent = false
  const chat = { subscribe: (listener: (value: Session) => void) => hermes.watch(created.value, listener) }
  const settled = await until<Session, Session>('the turn to settle', chat, (session, done, stop) => {
    if (session.sync.state === 'live' && !sent) {
      sent = true
      void hermes.run({ do: 'send', sessionId: created.value, text: MESSAGE }).then(result => {
        if (!result.ok) stop(`send refused: ${result.refusal.message}`)
      })
    }
    if (sent && session.run.state === 'idle' && session.history.length > 0) done(session)
  })

  const text = outline(threadView(settled))
  console.log(text)
  const last = text.split('\n').at(-1) ?? ''
  if (!last.startsWith('✓ ') && !last.startsWith("✗ Hermes couldn't sign in")) throw new Error(`unexpected last line: ${last}`)
}

console.log('This writes one new chat to your real Hermes on every run.')
let code = 0
try {
  await check()
  say('PASS')
} catch (error) {
  console.error(`FAIL ${error instanceof Error ? error.message : error}`)
  code = 1
}
say(`diagnostics ${JSON.stringify(Object.fromEntries(diagnostics))}`)
await hermes.close()
process.exit(code)

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session } from '../packages/hermes/src/domain'
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

const until = <T>(what: string, start: (done: (value: T) => void, stop: (reason: string) => void) => () => void) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS / 1000}s waiting for ${what}`)), TIMEOUT_MS)
    const off = start(
      value => { clearTimeout(timer); off(); resolve(value) },
      reason => { clearTimeout(timer); off(); reject(new Error(reason)) }
    )
  })

async function check(): Promise<string> {
  await until<void>('the link to come online', (done, stop) => hermes.link.subscribe(link => {
    if (link.state === 'online') done()
    if (link.state === 'blocked') stop(`link refused: ${link.message}`)
  }))
  say('link online')

  const rows = await until<number>('the sidebar listing', done => hermes.sidebar.subscribe(sidebar => { if (sidebar.status === 'ready') done(sidebar.rows.length) }))
  say(`listed ${rows} chats`)

  const cwd = mkdtempSync(join(tmpdir(), 'highwing-live-check-'))
  const created = await hermes.run({ do: 'create', draftId: crypto.randomUUID(), cwd })
  if (!created.ok) throw new Error(`create refused: ${created.refusal.message}`)
  say(`created chat ${created.value} in ${cwd}`)

  let sent = false
  const settled = await until<Session>('the turn to settle', (done, stop) => hermes.watch(created.value, session => {
    if (session.sync.state === 'live' && !sent) {
      sent = true
      void hermes.run({ do: 'send', sessionId: created.value, text: MESSAGE }).then(result => {
        if (!result.ok) stop(`send refused: ${result.refusal.message}`)
      })
    }
    if (sent && session.run.state === 'idle' && session.history.length > 0) done(session)
  }))

  const text = outline(threadView(settled))
  console.log(text)
  const last = text.split('\n').at(-1) ?? ''
  if (!last.startsWith('✓ ') && !last.startsWith("✗ Hermes couldn't sign in")) throw new Error(`unexpected last line: ${last}`)
  return last
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

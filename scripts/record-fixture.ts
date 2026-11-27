/**
 * Records one turn of the Hermes on this computer into a raw fixture, through the real client.
 *
 *   pnpm exec tsx scripts/record-fixture.ts <out.jsonl> <request>
 *
 * It starts a new chat with <request>, and waits until the chat has been idle
 * for QUIET_MS. That takes in a turn Hermes starts itself when a background helper finishes. It then
 * opens the chat once more from a second client so the fixture ends with the stored rows. Any approval
 * is answered "deny" and any question "Skip this." The raw file holds the gateway's real replies, session list included, so write
 * it under fixtures/recorded/ (git-ignored) and pass it through `fixtures/clean_recording.py` before
 * committing.
 */
import { randomUUID } from 'node:crypto'
import type { Session, SessionId } from '../packages/hermes/src/domain/session'
import { liveRoute, openHermes, type Hermes } from '../packages/hermes/src/hub'
import { recordingDialer } from '../packages/hermes/src/testing/record'

const [out, request] = process.argv.slice(2)
if (!out || !request) throw new Error('usage: record-fixture.ts <out.jsonl> <request>')

const TURN_MS = 15 * 60_000
const QUIET_MS = 30_000
const dial = recordingDialer(liveRoute().dial, out)
const client = { name: 'highwing-record', version: '0' }

function until(hermes: Hermes, id: SessionId, done: (session: Session) => boolean, ms: number): Promise<Session> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no settled session after ${ms} ms`)), ms)
    const stop = hermes.watch(id, session => {
      if (!done(session)) return
      clearTimeout(timer)
      queueMicrotask(() => stop())
      resolve(session)
    })
  })
}

function quiet(hermes: Hermes, id: SessionId): Promise<Session> {
  return new Promise(resolve => {
    let latest: Session | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const stop = hermes.watch(id, session => {
      latest = session
      if (timer !== null) clearTimeout(timer)
      timer = session.run.state !== 'idle' ? null : setTimeout(() => {
        stop()
        resolve(latest as Session)
      }, QUIET_MS)
    })
  })
}

const online = (hermes: Hermes) => new Promise<void>(resolve => {
  if (hermes.link.get().state === 'online') return resolve()
  const stop = hermes.link.subscribe(link => {
    if (link.state !== 'online') return
    stop()
    resolve()
  })
})

const first = openHermes({ dial, client })
await online(first)
const draftId = randomUUID()
const opened = await first.run({ do: 'open', ref: { kind: 'new', bot: null, draftId } })
if (!opened.ok) throw new Error(`the new chat was refused: ${opened.refusal.message}`)
const started = await first.run({ do: 'start', chat: { kind: 'new', bot: null, draftId, sessionId: null }, text: request })
if (!started.ok) throw new Error(`the first message was refused: ${started.refusal.message}`)
const shown = first.open.get().shown
if (shown?.kind !== 'new' || shown.draftId !== draftId || shown.sessionId === null) throw new Error('the new chat is not the one shown')
const id = shown.sessionId

const denied = new Set<string>()
const stopDenying = first.watch(id, session => {
  if (session.run.state !== 'running') return
  for (const item of session.run.turn.items) {
    if (item.kind !== 'prompt' || item.state.s !== 'waiting' || denied.has(item.id)) continue
    denied.add(item.id)
    process.stderr.write(`denying ${item.ask.kind} prompt ${item.id}\n`)
    void first.run({ do: 'answer', sessionId: id, promptId: item.id, reply: item.ask.kind === 'approval' ? { kind: 'choice', value: 'deny' } : { kind: 'text', value: 'Skip this.' } })
  }
})
await until(first, id, session => session.run.state === 'idle' && session.history.length > 0 && session.outbox.length === 0, TURN_MS)
const settled = await quiet(first, id)
stopDenying()
process.stderr.write(`${settled.history.length} turns, the last ${JSON.stringify(settled.history.at(-1)?.outcome)}\n`)
await first.close()

const second = openHermes({ dial, client })
await online(second)
await until(second, id, session => session.sync.state === 'live', 30_000)
await second.close()
process.stderr.write(`recorded ${id} to ${out}\n`)
process.exit(0)

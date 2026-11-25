import { describe, expect, it } from 'vitest'
import type { CommandOutcome, PathMatch } from '../src/domain'
import { play, type Fixture } from '../src/testing/fixture'
import { callsIn, ERRAND, SESSION } from './support/errand'

const WITH_PATHS: Fixture = {
  ...ERRAND,
  header: {
    ...ERRAND.header,
    paths: {
      cwd: '/home/sam/errands',
      words: {
        '@not': { items: [{ text: '@file:notes.md', meta: '' }, { text: '@notes-bot', meta: '' }, { text: '@folder:notebooks/', meta: 'dir' }] }
      }
    }
  }
}

async function matchesFor(fixture: Fixture, word: string) {
  let result: Promise<CommandOutcome<readonly PathMatch[]>> | null = null
  let cwd: string | null = null
  let received: readonly unknown[] = []
  for await (const { hermes, session, script } of play(fixture)) {
    cwd ??= session.cwd
    if (session.sync.state === 'live') result ??= hermes.run({ do: 'completePath', sessionId: SESSION, word })
    received = script.received
  }
  return { outcome: await result, cwd, received }
}

describe('completing a path through the scripted gateway', () => {
  it('lists the files and folders Hermes names for the typed word, and shows the chat its folder', async () => {
    const { outcome, cwd, received } = await matchesFor(WITH_PATHS, '@not')
    expect(outcome).toEqual({ ok: true, value: [{ path: 'notes.md', folder: false }, { path: 'notebooks/', folder: true }] })
    expect(cwd).toBe('/home/sam/errands')
    expect(callsIn(received).filter(call => call.method === 'complete.path').map(call => call.params)).toEqual([{ session_id: SESSION, word: '@not' }])
  })

  it('lists nothing for a word Hermes has no rows for', async () => {
    expect((await matchesFor(WITH_PATHS, '@zzz')).outcome).toEqual({ ok: true, value: [] })
  })

  it('refuses as unsupported on a Hermes without the call', async () => {
    expect((await matchesFor(ERRAND, '@not')).outcome).toMatchObject({ ok: false, refusal: { kind: 'unsupported' } })
  })
})

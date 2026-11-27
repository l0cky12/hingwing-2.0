import type { Feed } from '@highwing/hermes'
import { describe, expect, it } from 'vitest'
import { OFF, type Intro } from '../src/intro'
import type { Setup } from '../src/ipc-contract'
import type { ConnectionOwner } from '../src/main/connection'
import { chatLinks } from '../src/main/links'

const LIVE = { target: { kind: 'local' }, reach: 'host' } as unknown as Extract<Setup, { at: 'chat' }>['live']

function owner(setup: Setup, at: Intro = OFF) {
  let value = setup
  const listeners = new Set<(value: Setup) => void>()
  const commands: unknown[] = []
  const feed: Feed<Setup> = { get: () => value, subscribe: listener => (listeners.add(listener), () => void listeners.delete(listener)) }
  let phase = at
  const introListeners = new Set<(value: Intro) => void>()
  const intro: Feed<Intro> = { get: () => phase, subscribe: listener => (introListeners.add(listener), () => void introListeners.delete(listener)) }
  const raised: number[] = []
  const run = (async (command: unknown) => (commands.push(command), { ok: true, value: null })) as ConnectionOwner['run']
  return {
    held: { setup: feed, run }, intro, commands, raised,
    raise: () => void raised.push(commands.length),
    move: (next: Setup) => {
      value = next
      for (const listener of [...listeners]) listener(next)
    },
    setIntro: (next: Intro) => {
      phase = next
      for (const listener of [...introListeners]) listener(next)
    }
  }
}

const opens = (sessionId: string) => ({ do: 'open', ref: { kind: 'link', sessionId } })

describe('chat links', () => {
  it('opens the chat a launch names, raising the window before it asks', () => {
    const links = chatLinks()
    links.holdLatest(['/usr/lib/highwing/highwing', '--ozone-platform-hint=auto', 'highwing://chat/local-0001'])
    const app = owner({ at: 'pinned' })
    links.serve(app.held, app.intro, app.raise)
    expect(app.commands).toEqual([opens('local-0001')])
    expect(app.raised).toEqual([0])
  })

  it('opens a link from a later launch at once, and only once', () => {
    const links = chatLinks()
    const app = owner({ at: 'chat', live: LIVE })
    links.serve(app.held, app.intro, app.raise)
    links.holdLatest(['highwing', 'highwing://chat/local-0002'])
    app.move({ at: 'chat', live: LIVE })
    expect(app.commands).toEqual([opens('local-0002')])
  })

  it('holds a link while the setup screen is up, and opens only the latest one once the chat shows', () => {
    const links = chatLinks()
    const app = owner({ at: 'form', live: null, notice: null })
    links.serve(app.held, app.intro, app.raise)
    links.holdLatest(['highwing://chat/local-0001'])
    links.holdLatest(['highwing://chat/local-0002'])
    app.move({ at: 'saved', live: LIVE, from: 'first-run' })
    expect(app.commands, 'the saved screen is still up').toEqual([])
    app.move({ at: 'chat', live: LIVE })
    expect(app.commands).toEqual([opens('local-0002')])
  })

  it('ignores a command line with no link, or a malformed one, and does not raise for it', () => {
    const links = chatLinks()
    const app = owner({ at: 'pinned' })
    links.serve(app.held, app.intro, app.raise)
    links.holdLatest(['highwing', '--flag', 'https://example.com', 'highwing://chat/a/../b', 'highwing://send/local-0001'])
    expect(app.commands).toEqual([])
    expect(app.raised).toEqual([])
  })

  it('opens nothing after it stops serving', () => {
    const links = chatLinks()
    const app = owner({ at: 'pinned' })
    links.serve(app.held, app.intro, app.raise)()
    links.holdLatest(['highwing://chat/local-0001'])
    expect(app.commands).toEqual([])
  })

  it('holds a link while the intro covers the chat or the first connection, and opens it once the requests are up', () => {
    const links = chatLinks()
    const app = owner({ at: 'chat', live: LIVE }, { at: 'due' })
    links.serve(app.held, app.intro, app.raise)
    links.holdLatest(['highwing://chat/local-0003'])
    expect(app.commands).toEqual([])
    app.move({ at: 'saved', live: LIVE, from: 'first-run' })
    expect(app.commands).toEqual([])
    app.move({ at: 'chat', live: LIVE })
    expect(app.commands).toEqual([])
    app.setIntro({ at: 'examples' })
    expect(app.commands).toEqual([opens('local-0003')])
    expect(app.raised).toEqual([0])
  })
})

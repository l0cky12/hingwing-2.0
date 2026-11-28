import type { BotId, OpenChat, SessionId } from '@highwing/hermes/domain'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComposerGroup } from '../src/renderer/composer/Composer'
import { APPROVED } from './support/bots'

const topics = vi.hoisted(() => ({ values: {} as Record<string, unknown> }))

vi.mock('react', async original => ({
  ...(await original<typeof import('react')>()),
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read()
}))
vi.mock('../src/renderer/store', () => ({
  Epoch: {},
  run: async () => ({ ok: true, value: undefined }),
  transcribe: async () => ({ ok: true, value: '' }),
  useTopic: (topic: string | null) => (topic === null ? undefined : topics.values[topic])
}))

const { Composer } = await import('../src/renderer/composer/Composer')

const CSS = readFileSync(new URL('../src/renderer/styles/app.css', import.meta.url), 'utf8')
const openWith = (bot: string | null): OpenChat => ({ shown: { kind: 'chat', bot: bot as BotId | null, sessionId: 's1' as SessionId }, opening: null, missing: null })
const CONTROLS = ['Smart approvals', 'Folder: /work', 'Model: fast-small', 'Effort: Default', 'Context about 3% full']
const control = (name: string) => <button key={name} type="button" aria-label={name} />
const draw = (group?: ComposerGroup) => renderToStaticMarkup(
  <Composer
    slot={null} {...(group === undefined ? {} : { group })} canSend canAttach showStop onSend={async () => ({ ok: true, value: null })} onStop={() => {}} onInput={() => {}}
    start={CONTROLS.slice(0, 2).map(control)} end={CONTROLS.slice(2).map(control)}
  />
)
const placeholderOf = (html: string) => / placeholder="([^"]*)"/.exec(html)?.[1]
const namesIn = (html: string) => Array.from(html.matchAll(/<(?:button|textarea)[^>]* aria-label="([^"]*)"/g), ([, name]) => name)
const parts = (html: string) => {
  const cut = html.indexOf('<div class="tools">')
  return { pill: html.slice(html.indexOf('<div class="pill">'), cut), row: html.slice(cut, html.indexOf('</footer>')) }
}

beforeEach(() => {
  topics.values = { open: openWith('research'), bots: APPROVED, slash: [] }
})

describe('the pill composer', () => {
  it('asks for a message to the open bot by name, and to Hermes when the chat has no bot', () => {
    expect(placeholderOf(draw())).toBe('Message Research')
    topics.values.open = openWith(null)
    expect(placeholderOf(draw())).toBe('Message Hermes')
  })

  it('keeps the group chat’s own placeholder', () => {
    expect(placeholderOf(draw({ name: 'Launch plan', mentions: [], warning: null }))).toBe('Message the group, or type @ to ask specific bots')
  })

  it('holds the message box, Attach files, Dictate, Stop and Send in the pill', () => {
    expect(namesIn(parts(draw()).pill)).toEqual(['Message Hermes', 'Attach files', 'Dictate', 'Stop', 'Send'])
  })

  it('keeps approvals, folder, model, effort and the context meter reachable in the row under the pill', () => {
    expect(namesIn(parts(draw()).row)).toEqual(CONTROLS)
  })

  it('fills Send with the accent, which is the open bot’s colour unless Settings fixes one, and draws its icon in the sheet colour', () => {
    const send = /\.pill \.send \{([^}]*)\}/.exec(CSS)?.[1] ?? ''
    expect(send).toContain('background: var(--accent, var(--ink));')
    expect(send).toContain('color: var(--sheet);')
  })
})

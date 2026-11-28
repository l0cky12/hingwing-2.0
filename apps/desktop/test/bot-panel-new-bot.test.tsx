import type { BotDraft, BotId, OpenChat } from '@highwing/hermes/domain'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowCommand } from '../src/ipc-contract'
import { fact, listed } from './support/bots'

/** Each component's hooks keep their values between draws, keyed by the component's name and the hook's place in it. */
const hooks = vi.hoisted(() => ({ slots: new Map<string, unknown>(), drawing: '', at: 0 }))
const slot = <T,>(start: () => T): [T, (next: T | ((held: T) => T)) => void] => {
  const key = `${hooks.drawing}#${hooks.at++}`
  if (!hooks.slots.has(key)) hooks.slots.set(key, start())
  return [hooks.slots.get(key) as T, next => hooks.slots.set(key, typeof next === 'function' ? (next as (held: T) => T)(hooks.slots.get(key) as T) : next)]
}
const seen = vi.hoisted(() => ({ topics: {} as Record<string, unknown>, commands: [] as WindowCommand[] }))

vi.mock('react', async original => ({
  ...(await original<typeof import('react')>()),
  useState: (start: unknown) => slot(() => (typeof start === 'function' ? (start as () => unknown)() : start)),
  useReducer: (reduce: (state: unknown, action: unknown) => unknown, arg: unknown, init?: (arg: unknown) => unknown) => {
    const [state, set] = slot(() => (init === undefined ? arg : init(arg)))
    return [state, (action: unknown) => set((held: unknown) => reduce(held, action))]
  },
  useRef: (start: unknown) => slot(() => ({ current: start }))[0],
  useCallback: (call: unknown) => call,
  useMemo: (make: () => unknown) => make(),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useId: () => 'id',
  useContext: () => 0,
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read()
}))
vi.mock('../src/renderer/store', () => ({
  Epoch: {},
  pickBotPicture: async () => ({ ok: true, value: 'cancelled' }),
  run: async (command: WindowCommand) => {
    seen.commands.push(command)
    if (command.do === 'describeBot') return { ok: true, value: { bot: command.bot, name: 'Rae', description: '', persona: '', revision: 1 } }
    if (command.do === 'botModels') return { ok: true, value: { options: [{ id: 'careful-large', provider: 'acme', providerName: 'Acme' }], fallback: null } }
    return { ok: true, value: undefined }
  },
  useTopic: (topic: string | null) => (topic === null ? undefined : seen.topics[topic])
}))

const { TopBar } = await import('../src/renderer/chrome/Chrome')

interface Props {
  readonly [key: string]: unknown
  readonly children?: ReactNode
  readonly onClick?: () => void
  readonly onCreate?: (draft: BotDraft, picture: string) => Promise<unknown>
}
interface Drawn { readonly type: string; readonly props: Props }

function draw(node: ReactNode, found: Drawn[] = []): Drawn[] {
  if (Array.isArray(node)) node.forEach(child => draw(child, found))
  else if (isValidElement(node)) {
    const { type, props } = node as ReactElement<Props>
    if (typeof type === 'function') {
      found.push({ type: type.name, props })
      hooks.drawing = type.name
      hooks.at = 0
      return draw((type as (props: Props) => ReactNode)(props), found)
    }
    if (typeof type === 'string') found.push({ type, props })
    draw(props.children, found)
  }
  return found
}
const textOf = (node: ReactNode): string =>
  Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'string' ? node : isValidElement(node) ? textOf((node.props as Props).children) : ''
const screen = () => draw(<TopBar target={null} />)
const button = (name: string) => screen().find(({ type, props }) => type === 'button' && (props['aria-label'] === name || textOf(props.children) === name))
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

const RAE = 'rae' as BotId
const OPEN: OpenChat = { shown: { kind: 'bot', bot: RAE, sessionId: 's1' as never }, opening: null, missing: null }

beforeEach(() => {
  hooks.slots.clear()
  seen.commands = []
  seen.topics = { open: OPEN, bots: listed(fact('rae', 'Rae')), 'session:s1': { title: 'Bot Chat' } }
  vi.stubGlobal('document', { querySelector: () => null })
})

describe("the open bot's profile panel", () => {
  it('opens the New bot form the plus menu opens, with the models Hermes offers and the same create call', async () => {
    button('Details for Rae')!.props.onClick!()
    await settle()
    expect(button('Upload picture'), 'the panel is open').toBeDefined()

    const entry = button('New bot…')!
    expect(entry.props['aria-haspopup']).toBe('dialog')
    entry.props.onClick!()
    await settle()

    const drawn = screen()
    const dialog = drawn.find(({ type }) => type === 'dialog')!
    expect(textOf(drawn.find(({ type }) => type === 'h2')!.props.children)).toBe('New bot')
    expect(dialog.props.className).toBe('bot-form')
    expect(button('Upload picture'), 'the profile panel gave way to the form').toBeUndefined()
    expect(button('Create')).toBeDefined()
    expect(drawn.filter(({ type }) => type === 'option').map(({ props }) => textOf(props.children))).toContain('careful-large')
    expect(seen.commands.map(command => command.do)).toEqual(['describeBot', 'botModels'])

    const draft: BotDraft = { name: 'Sam', description: '', model: null, persona: '' }
    await drawn.find(({ type }) => type === 'NewBotForm')!.props.onCreate!(draft, 'data:image/png;base64,')
    expect(seen.commands.at(-1)).toEqual({ do: 'createBot', draft, picture: 'data:image/png;base64,' })
  })
})

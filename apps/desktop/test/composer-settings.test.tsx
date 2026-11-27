import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowCommand } from '../src/ipc-contract'

const seen = vi.hoisted(() => ({ commands: [] as unknown[], topics: {} as Record<string, unknown> }))

vi.mock('react', async original => ({
  ...(await original<typeof import('react')>()),
  useId: () => 'id'
}))
vi.mock('../src/renderer/store', () => ({
  Epoch: {},
  run: async (command: WindowCommand) => (seen.commands.push(command), { ok: true, value: undefined }),
  useTopic: (topic: string | null) => (topic === null ? undefined : seen.topics[topic])
}))

const { COMMAND_KEY } = await import('../src/renderer/keys')
const { ComposerRows } = await import('../src/renderer/setup/Settings')

type Props = { readonly children?: ReactNode; readonly role?: string; readonly checked?: boolean; readonly 'aria-labelledby'?: string; readonly onChange?: (event: { target: { checked: boolean } }) => void }

function switches(node: ReactNode, found: Props[] = []): Props[] {
  if (Array.isArray(node)) node.forEach(child => switches(child, found))
  else if (isValidElement(node)) {
    const { type, props } = node as ReactElement<Props>
    if (type === 'input' && props.role === 'switch') found.push(props)
    switches(props.children, found)
  }
  return found
}
const settings = () => switches(ComposerRows({ off: () => false }))
const named = (labelledBy: string) => settings().find(control => control['aria-labelledby'] === labelledBy)!

beforeEach(() => {
  seen.commands = []
  seen.topics = {}
})

describe('the Composer page of Settings', () => {
  it('offers a send-key switch, off while Enter sends, and a spell-check switch, on while nothing says otherwise', () => {
    seen.topics = { sendKey: 'enter', spellCheck: undefined }
    expect(named('id-send-key').checked).toBe(false)
    expect(named('id-spell').checked).toBe(true)
  })

  it('shows the switches as main last kept them', () => {
    seen.topics = { sendKey: 'modEnter', spellCheck: false }
    expect(named('id-send-key').checked).toBe(true)
    expect(named('id-spell').checked).toBe(false)
  })

  it(`sends setSendKey with the key that sends, from the ${COMMAND_KEY}+Enter switch`, () => {
    seen.topics = { sendKey: 'enter' }
    named('id-send-key').onChange!({ target: { checked: true } })
    seen.topics = { sendKey: 'modEnter' }
    named('id-send-key').onChange!({ target: { checked: false } })
    expect(seen.commands).toEqual([{ do: 'setSendKey', sendKey: 'modEnter' }, { do: 'setSendKey', sendKey: 'enter' }])
  })

  it('sends setSpellCheck with the toggled value from the spell-check switch', () => {
    named('id-spell').onChange!({ target: { checked: false } })
    named('id-spell').onChange!({ target: { checked: true } })
    expect(seen.commands).toEqual([{ do: 'setSpellCheck', spellCheck: false }, { do: 'setSpellCheck', spellCheck: true }])
  })
})

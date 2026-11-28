import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_APPEARANCE, type Appearance } from '../src/appearance'
import type { WindowCommand } from '../src/ipc-contract'

const seen = vi.hoisted(() => ({ commands: [] as WindowCommand[], appearance: undefined as unknown }))

vi.mock('react', async original => ({
  ...(await original<typeof import('react')>()),
  useId: () => 'id',
  useState: (initial: unknown) => [initial, () => {}],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: () => {}
}))
vi.mock('../src/renderer/store', () => ({
  Epoch: {},
  run: async (command: WindowCommand) => (seen.commands.push(command), { ok: true, value: undefined }),
  useTopic: (topic: string | null) => (topic === 'appearance' ? seen.appearance : undefined)
}))

const { AppearanceRows } = await import('../src/renderer/setup/AppearanceRows')

interface Props {
  readonly [key: string]: unknown
  readonly children?: ReactNode
  readonly onChange?: (event: { target: { value: string; checked: boolean } }) => void
  readonly onClick?: () => void
}
interface Found { readonly type: string; readonly props: Props }

/** Every element the rows draw, with each component called through to the elements it returns. */
function drawn(node: ReactNode, found: Found[] = []): Found[] {
  if (Array.isArray(node)) node.forEach(child => drawn(child, found))
  else if (isValidElement(node)) {
    const { type, props } = node as ReactElement<Props>
    if (typeof type === 'function') return drawn((type as (props: Props) => ReactNode)(props), found)
    if (typeof type === 'string') found.push({ type, props })
    drawn(props.children, found)
  }
  return found
}
const textOf = (node: ReactNode): string =>
  Array.isArray(node) ? node.map(textOf).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : isValidElement(node) ? textOf((node.props as Props).children) : ''

const rows = () => drawn(<AppearanceRows off={() => false} />)
const select = (label: string) => rows().find(({ type, props }) => type === 'select' && props['aria-label'] === label)!
const optionsOf = (label: string) => drawn(select(label).props.children).filter(({ type }) => type === 'option').map(({ props }) => [props.value, textOf(props.children)])
const button = (label: string) => rows().find(({ type, props }) => type === 'button' && props['aria-label'] === label)
const wrapSwitch = (role: string) => {
  const label = rows().find(({ type, props }) => type === 'label' && textOf(props.children) === `Wrap long ${role} lines`)!
  return drawn(label.props.children).find(({ type }) => type === 'input')!
}
const sent = () => seen.commands.map(command => (command as { appearance: Appearance }).appearance)

beforeEach(() => {
  seen.commands = []
  seen.appearance = DEFAULT_APPEARANCE
})

describe('the Appearance rows of Settings', () => {
  it.each([
    ['Interface font', 'Schibsted Grotesk', 14],
    ['Prompt font', 'Schibsted Grotesk', 15],
    ['Code font', 'JetBrains Mono', 13],
    ['Terminal font', 'JetBrains Mono', 12]
  ])('offers the %s at Highwing’s own face and size, with no reset', (label, face, size) => {
    expect(select(label).props.value).toBe('')
    expect(optionsOf(label)[0]).toEqual(['', `Default (${face})`])
    expect(select(`${label} size`).props.value).toBe(size)
    expect(button(`Reset ${label.toLowerCase()}`)).toBeUndefined()
  })

  it('leaves long code lines unwrapped and terminal lines wrapped, as they always were', () => {
    expect(wrapSwitch('code').props.checked).toBe(false)
    expect(wrapSwitch('terminal').props.checked).toBe(true)
  })

  it('sends the whole appearance with the one size changed', () => {
    select('Code font size').props.onChange!({ target: { value: '16', checked: false } })
    expect(sent()).toEqual([{ ...DEFAULT_APPEARANCE, fonts: { ...DEFAULT_APPEARANCE.fonts, code: { family: null, size: 16 } } }])
  })

  it('keeps a pick made before main echoes the one before it', () => {
    const drawnOnce = rows()
    const pickOf = (label: string) => drawnOnce.find(({ type, props }) => type === 'select' && props['aria-label'] === label)!.props.onChange!
    pickOf('Interface font')({ target: { value: 'DejaVu Sans', checked: false } })
    pickOf('Prompt font size')({ target: { value: '18', checked: false } })
    expect(sent()[1]!.fonts).toEqual({ ...DEFAULT_APPEARANCE.fonts, interface: { family: 'DejaVu Sans', size: 14 }, prompt: { family: null, size: 18 } })
  })

  it('keeps offering a saved face this computer no longer lists, and resets the role to its own face, size and wrap', () => {
    seen.appearance = { ...DEFAULT_APPEARANCE, fonts: { ...DEFAULT_APPEARANCE.fonts, code: { family: 'Fira Code', size: 15 } }, wrap: { code: true, terminal: true } }
    expect(select('Code font').props.value).toBe('Fira Code')
    expect(optionsOf('Code font')).toContainEqual(['Fira Code', 'Fira Code'])
    button('Reset code font')!.props.onClick!()
    expect(sent()).toEqual([DEFAULT_APPEARANCE])
  })

  it('picks Highwing’s own face again from Default', () => {
    seen.appearance = { ...DEFAULT_APPEARANCE, fonts: { ...DEFAULT_APPEARANCE.fonts, prompt: { family: 'Inter', size: 15 } } }
    select('Prompt font').props.onChange!({ target: { value: '', checked: false } })
    expect(sent()).toEqual([DEFAULT_APPEARANCE])
  })

  it('wraps long terminal lines from its switch', () => {
    wrapSwitch('terminal').props.onChange!({ target: { value: 'on', checked: false } })
    expect(sent()).toEqual([{ ...DEFAULT_APPEARANCE, wrap: { code: false, terminal: false } }])
  })

  it('offers the four chat widths, Comfortable picked', () => {
    const width = rows().find(({ type, props }) => type === 'select' && props['aria-labelledby'] === 'id' && props.value === 'comfortable')!
    expect(drawn(width.props.children).map(({ props }) => textOf(props.children))).toEqual(['Narrow', 'Comfortable', 'Wide', 'Full width'])
    width.props.onChange!({ target: { value: 'wide', checked: false } })
    expect(sent()).toEqual([{ ...DEFAULT_APPEARANCE, chatWidth: 'wide' }])
  })

  it('shows contrast and animation length with their units, and resets each only once it moved', () => {
    const ranges = () => rows().filter(({ type, props }) => type === 'input' && props.type === 'range')
    expect(ranges().map(({ props }) => [props.min, props.max, props.value, props['aria-valuetext']])).toEqual([[50, 150, 100, '100%'], [0, 400, 150, '150 ms']])
    expect(button('Reset contrast')).toBeUndefined()
    ranges()[1]!.props.onChange!({ target: { value: '0', checked: false } })
    expect(sent()).toEqual([{ ...DEFAULT_APPEARANCE, motionMs: 0 }])
    seen.appearance = { ...DEFAULT_APPEARANCE, contrast: 130 }
    button('Reset contrast')!.props.onClick!()
    expect(sent()[1]).toEqual(DEFAULT_APPEARANCE)
  })

  it('turns math typesetting off from its switch', () => {
    const math = rows().find(({ type, props }) => type === 'input' && props.role === 'switch' && props['aria-labelledby'] === 'id')!
    expect(math.props.checked).toBe(true)
    math.props.onChange!({ target: { value: 'on', checked: false } })
    expect(sent()).toEqual([{ ...DEFAULT_APPEARANCE, math: false }])
  })
})

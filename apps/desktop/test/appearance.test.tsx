import type { Target } from '@highwing/hermes/domain'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Theme, WindowCommand } from '../src/ipc-contract'
import type { CardSetup } from '../src/renderer/setup/screens'

interface Shown { readonly labelledBy: string; readonly value: string; readonly onPick: (value: string) => void }
const seen = vi.hoisted(() => ({ commands: [] as unknown[], segmented: [] as Shown[] }))

vi.mock('../src/renderer/store', () => ({
  Epoch: {},
  run: async (command: WindowCommand) => (seen.commands.push(command), { ok: true, value: undefined }),
  useTopic: (topic: string | null) => (topic === 'link' ? { state: 'online' } : undefined)
}))
vi.mock('../src/renderer/setup/ConnectionCard', async original => {
  const real = await original<typeof import('../src/renderer/setup/ConnectionCard')>()
  return {
    ...real,
    Segmented: (props: Shown & { readonly segments: readonly { readonly value: string; readonly label: string; readonly icon: ReactNode }[] }) => {
      seen.segmented.push(props)
      return real.Segmented(props)
    }
  }
})

const { Settings } = await import('../src/renderer/setup/Settings')

const HOST: Target = { kind: 'local' }
const AT_REST: CardSetup = { at: 'form', live: { target: HOST, epoch: 1 }, notice: null }
const render = (theme: Theme) => renderToStaticMarkup(<Settings setup={AT_REST} mode="bots" theme={theme} onRequestClose={() => {}} />)
const labelOf = (html: string, id: string) => new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)?.[1]

beforeEach(() => {
  seen.commands = []
  seen.segmented = []
})

describe('the Appearance section of Settings', () => {
  it('sits between Connection and Sidebar, with a Theme row offering System, Light and Dark', () => {
    const html = render('system')
    expect(Array.from(html.matchAll(/<h3 [^>]*>([^<]*)<\/h3>/g), ([, heading]) => heading)).toEqual(['Connection', 'Appearance', 'Sidebar', 'Skills', 'Keyboard shortcuts'])
    const theme = seen.segmented.find(control => labelOf(html, control.labelledBy) === 'Theme')!
    expect(theme.value).toBe('system')
    expect(html).toContain('System follows your computer’s light or dark setting.')
    const group = new RegExp(`<div class="seg" role="radiogroup" aria-labelledby="${theme.labelledBy}">(.*?)</div>`).exec(html)![1]!
    expect(Array.from(group.matchAll(/<label><input type="radio"[^>]*?( checked="")?\/><svg[^>]*>.*?<\/svg>(\w+)<\/label>/g), ([, checked, label]) => `${label}${checked ? ' (checked)' : ''}`))
      .toEqual(['System (checked)', 'Light', 'Dark'])
  })

  it.each(['light', 'dark', 'system'] satisfies Theme[])('asks main to draw %s when that segment is picked', picked => {
    const html = render(picked === 'system' ? 'dark' : 'system')
    seen.segmented.find(control => labelOf(html, control.labelledBy) === 'Theme')!.onPick(picked)
    expect(seen.commands).toEqual([{ do: 'setTheme', theme: picked }])
  })
})

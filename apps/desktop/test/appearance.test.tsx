import type { Target } from '@highwing/hermes/domain'
import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Accent, ShowWork, Theme, WindowCommand } from '../src/ipc-contract'
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

import { live } from './support/live'
const { Settings } = await import('../src/renderer/setup/Settings')

const HOST: Target = { kind: 'local' }
const AT_REST: CardSetup = { at: 'form', live: live(HOST, 1), notice: null }
const render = (theme: Theme, accent: Accent = 'bot') => renderToStaticMarkup(<Settings setup={AT_REST} mode="bots" theme={theme} accent={accent} onRequestClose={() => {}} onShowShortcuts={() => {}} />)
const labelOf = (html: string, id: string) => new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(html)?.[1]
const groupOf = (html: string, look: string, labelledBy: string) =>
  new RegExp(`<div class="${look}" role="radiogroup" aria-labelledby="${labelledBy}" aria-describedby="${labelledBy}-desc">(.*?)</div>`).exec(html)![1]!
const choicesOf = (group: string) =>
  Array.from(group.matchAll(/<label><input type="radio"[^>]*?( checked="")?\/>(?:(?!<\/label>).)*?(\w+)<\/label>/g), ([, checked, label]) => `${label}${checked ? ' (checked)' : ''}`)

beforeEach(() => {
  seen.commands = []
  seen.segmented = []
})

const PAGE_ORDER = ['Connection', 'Models', 'Appearance', 'Composer', 'Window', 'Notifications', 'Password managers', 'Permissions', 'Keyboard shortcuts', 'Usage', 'About']
const cardsOf = (html: string) => Array.from(html.matchAll(/<section([^>]*)>/g), ([, attributes], at) => `${PAGE_ORDER[at]}${attributes!.includes(' hidden=""') ? ' (hidden)' : ''}`)
const titleId = (html: string) => /<h2 id="([^"]*)"/.exec(html)![1]

describe('Settings', () => {
  it('opens on the Connection page, with every other page beside it in the nav', () => {
    const html = render('system')
    const nav = /<nav [^>]*aria-label="Settings pages">(.*?)<\/nav>/.exec(html)![1]!
    expect(Array.from(nav.matchAll(/<button type="button"( aria-current="page")?[^>]*>.*?<\/svg>([^<]*)<\/button>/g), ([, current, label]) => `${label}${current ? ' (current)' : ''}`))
      .toEqual(PAGE_ORDER.map((label, at) => (at === 0 ? `${label} (current)` : label)))
    expect(/<h2[^>]*>([^<]*)<\/h2><p>([^<]*)<\/p>/.exec(html)!.slice(1)).toEqual(['Connection', 'The Hermes this app talks to, and how it reaches it.'])
    expect(cardsOf(html)).toEqual(PAGE_ORDER.map((label, at) => (at === 0 ? label : `${label} (hidden)`)))
    expect(Array.from(html.matchAll(/<section[^>]*aria-labelledby="([^"]*)"/g), ([, id]) => id)).toEqual(Array(PAGE_ORDER.length).fill(titleId(html)))
  })

  it('keeps Show all, which opens the shortcut sheet, on the Keyboard shortcuts page with a row for each shortcut', () => {
    const html = render('system')
    expect(html).toMatch(/aria-keyshortcuts="(Control|Meta)\+\/"[^>]*>Show all</)
    expect(html).toContain('<p class="label">Command palette</p><p class="desc">Works anywhere in Highwing.</p>')
    expect(html).toContain('<p class="label">Find in chat</p><p class="desc">Works in a chat.</p>')
  })
})

describe('the Theme and window-close rows of Settings', () => {
  it('sits on the Appearance page above Show in the sidebar, offering System, Light and Dark', () => {
    const html = render('system')
    const theme = seen.segmented.find(control => labelOf(html, control.labelledBy) === 'Theme')!
    expect(theme.value).toBe('system')
    expect(labelOf(html, `${theme.labelledBy}-desc`)).toBe('System follows your computer’s light or dark setting.')
    expect(choicesOf(groupOf(html, 'looks', theme.labelledBy))).toEqual(['System (checked)', 'Light', 'Dark'])
  })

  it('draws each theme as a small window in its scheme, System as both, colored by the picked accent', () => {
    const theme = (html: string) => groupOf(html, 'looks', seen.segmented.find(control => labelOf(html, control.labelledBy) === 'Theme')!.labelledBy)
    const windowsOf = (group: string) => Array.from(group.matchAll(/<label>(.*?)<\/label>/g), ([, choice]) =>
      Array.from(choice!.matchAll(/<span class="mini-window" data-scheme="(\w+)"(?: data-accent="(\w+)")?>/g), ([, scheme, accent]) => `${scheme} ${accent ?? 'none'}`).join(' + '))
    expect(windowsOf(theme(render('dark', 'plum')))).toEqual(['light plum + dark plum', 'light plum', 'dark plum'])
    seen.segmented = []
    expect(windowsOf(theme(render('dark', 'bot')))).toEqual(['light none + dark none', 'light none', 'dark none'])
  })

  it('shows Quit checked for a window close, and asks main to keep Highwing in the tray', () => {
    const html = render('system')
    const close = seen.segmented.find(control => labelOf(html, control.labelledBy) === 'When the window closes')!
    expect(close.value).toBe('quit')
    expect(labelOf(html, `${close.labelledBy}-desc`)).toBe('Quit leaves Highwing. Keep in the tray leaves it running.')
    const group = new RegExp(`<div class="seg" role="radiogroup" aria-labelledby="${close.labelledBy}" aria-describedby="${close.labelledBy}-desc">(.*?)</div>`).exec(html)![1]!
    expect(Array.from(group.matchAll(/<label><input type="radio"[^>]*?( checked="")?\/><svg[^>]*>.*?<\/svg>(.*?)<\/label>/g), ([, checked, label]) => `${label}${checked ? ' (checked)' : ''}`))
      .toEqual(['Quit (checked)', 'Keep in the tray'])
    close.onPick('stay')
    expect(seen.commands).toEqual([{ do: 'setOnClose', onClose: 'stay' }])
  })

  it.each(['light', 'dark', 'system'] satisfies Theme[])('asks main to draw %s when that segment is picked', picked => {
    const html = render(picked === 'system' ? 'dark' : 'system')
    seen.segmented.find(control => labelOf(html, control.labelledBy) === 'Theme')!.onPick(picked)
    expect(seen.commands).toEqual([{ do: 'setTheme', theme: picked }])
  })

  it('offers an Accent row right after Theme, with Bot checked until a color is picked', () => {
    const html = render('system')
    const labels = Array.from(html.matchAll(/<p class="label" id="[^"]*">([^<]*)<\/p>/g), ([, label]) => label)
    expect(labels.slice(labels.indexOf('Theme'), labels.indexOf('Theme') + 2)).toEqual(['Theme', 'Accent'])
    expect(html).toContain('Bot uses the color of the open chat’s bot.')
    const accent = seen.segmented.find(control => labelOf(html, control.labelledBy) === 'Accent')!
    expect(accent.value).toBe('bot')
    expect(choicesOf(groupOf(html, 'tones', accent.labelledBy))).toEqual(['Bot (checked)', 'Ink', 'Slate', 'Plum', 'Olive', 'Mauve', 'Umber'])
  })

  it.each(['bot', 'ink', 'slate', 'plum', 'olive', 'mauve', 'umber'] satisfies Accent[])('asks main for the %s accent when that segment is picked', picked => {
    const html = render('system', picked === 'bot' ? 'ink' : 'bot')
    seen.segmented.find(control => labelOf(html, control.labelledBy) === 'Accent')!.onPick(picked)
    expect(seen.commands).toEqual([{ do: 'setAccent', accent: picked }])
  })

  it('offers Show the bot’s work right after Accent, with Everything checked until another is picked', () => {
    const html = render('system')
    const labels = Array.from(html.matchAll(/<p class="label" id="[^"]*">([^<]*)<\/p>/g), ([, label]) => label)
    expect(labels.slice(labels.indexOf('Accent'), labels.indexOf('Accent') + 2)).toEqual(['Accent', 'Show the bot’s work'])
    expect(html).toContain('Replies only shows the bot hopping while it works, then just its final reply.')
    const work = seen.segmented.find(control => labelOf(html, control.labelledBy) === 'Show the bot’s work')!
    expect(work.value).toBe('all')
    expect(choicesOf(groupOf(html, 'seg', work.labelledBy))).toEqual(['only', 'Actions', 'Everything (checked)'])
  })

  it.each(['replies', 'actions', 'all'] satisfies ShowWork[])('asks main to show %s of the bot’s work when that segment is picked', picked => {
    const html = render('system')
    seen.segmented.find(control => labelOf(html, control.labelledBy) === 'Show the bot’s work')!.onPick(picked)
    expect(seen.commands).toEqual([{ do: 'setShowWork', showWork: picked }])
  })
})

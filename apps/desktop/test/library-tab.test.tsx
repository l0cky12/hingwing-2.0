import type { LibraryItem, LibraryItemId, LibraryRead, SessionId } from '@highwing/hermes/domain'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { LibraryList } from '../src/renderer/bots/Library'
import { afterStep, libraryViewOf, type LibraryPages } from '../src/renderer/bots/library-view'

const CLOCK = { now: Date.UTC(2026, 10, 24, 15, 0), timeZone: 'UTC' }
const CHAT = { sessionId: 'local-0301' as SessionId, title: 'Weekly report' }
const NOTES: LibraryItem = { id: 'hermes:/home/rae/notes.md' as LibraryItemId, kind: 'file', name: 'notes.md', at: Date.UTC(2026, 10, 24, 14, 5), chat: CHAT, where: { on: 'hermes', path: '/home/rae/notes.md' } }
const CHART: LibraryItem = { id: 'hermes:/home/rae/chart.svg' as LibraryItemId, kind: 'image', name: 'chart.svg', at: Date.UTC(2026, 10, 23, 9, 12), chat: CHAT, where: { on: 'hermes', path: '/home/rae/chart.svg' } }
const DOCS: LibraryItem = { id: 'web:https://example.com/docs' as LibraryItemId, kind: 'link', name: 'the docs', at: null, chat: CHAT, where: { on: 'web', url: 'https://example.com/docs' } }
const NONE = { busy: null, onOpen: () => {}, onSave: () => {}, onOlder: () => {} }

const pages = (read: Partial<LibraryRead> = {}): { ok: true; value: LibraryPages } =>
  ({ ok: true, value: afterStep(null, 0, { items: [NOTES, CHART, DOCS], chats: 10, reach: 'more', unread: 0, ...read }) })

describe('the Library tab', () => {
  it('lists each item by name, with its type and when its chat made it, and Save… for a file of the Hermes machine', () => {
    const html = renderToStaticMarkup(<LibraryList view={libraryViewOf(pages(), 'Rae', CLOCK)} {...NONE} />)
    expect(html).toContain('<ul class="library" aria-label="Library">')
    const rows = [...html.matchAll(/<li class="library-item" aria-busy="false"><button type="button" class="library-name">([^<]*)<\/button><span class="library-about">([^<]*)<\/span>(.*?)<\/li>/g)]
    expect(rows.map(([, name, about, controls]) => [name, about, [...controls!.matchAll(/aria-label="([^"]*)"/g)].map(([, label]) => label)])).toEqual([
      ['notes.md', 'File · Today 14:05', ['Save notes.md…']],
      ['chart.svg', 'Image · Yesterday 09:12', ['Save chart.svg…']],
      ['the docs', 'Link', []]
    ])
  })

  it('says how far back it looked, and offers older chats while there are more', () => {
    expect(libraryViewOf(pages(), 'Rae', CLOCK)).toMatchObject({ reached: "From Rae's 10 newest chats.", older: true })
    expect(libraryViewOf(pages({ unread: 2 }), 'Rae', CLOCK)).toMatchObject({ reached: "From Rae's 10 newest chats. Highwing couldn't read 2 of them.", older: true })
    expect(libraryViewOf(pages({ reach: 'all', chats: 4 }), 'Rae', CLOCK)).toMatchObject({ reached: null, older: false })
    expect(libraryViewOf(pages({ reach: 'all', chats: 4, unread: 1 }), 'Rae', CLOCK)).toMatchObject({ reached: "Highwing couldn't read 1 of Rae's chats.", older: false })
    const html = renderToStaticMarkup(<LibraryList view={libraryViewOf(pages(), 'Rae', CLOCK)} {...NONE} />)
    expect(html).toMatch(/<\/ul><p class="library-note">From Rae&#x27;s 10 newest chats.<\/p><button type="button" class="library-older" aria-busy="false">Look in older chats<\/button>$/)
  })

  it('joins an older step on, keeping the newer mention of an item both name, and counting every chat both looked at', () => {
    const older = { ...NOTES, at: 1000, chat: { sessionId: 'local-0100' as SessionId, title: 'Old notes' } }
    const PLAN: LibraryItem = { ...NOTES, id: 'hermes:/home/rae/plan.md' as LibraryItemId, name: 'plan.md', at: 900 }
    const joined = afterStep(pages().value, 1, { items: [older, PLAN], chats: 10, reach: 'all', unread: 1 })
    expect(joined).toEqual({ step: 1, items: [NOTES, CHART, PLAN, DOCS], chats: 20, reach: 'all', unread: 1 })
  })

  it("says the bot's chats made nothing yet, with how far back it looked", () => {
    expect(libraryViewOf(pages({ items: [] }), 'Rae', CLOCK)).toEqual({
      state: 'empty', hint: "Rae's chats haven't made a file, an image or a link yet.", reached: "From Rae's 10 newest chats.", older: true
    })
  })

  it("shows Hermes's refusal as an alert, and a loading line before the first answer", () => {
    const refused = libraryViewOf({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't list chats for Highwing." } }, 'Rae', CLOCK)
    expect(renderToStaticMarkup(<LibraryList view={refused} {...NONE} />)).toBe('<p class="library-note library-refused" role="alert">This Hermes can&#x27;t list chats for Highwing.</p>')
    expect(renderToStaticMarkup(<LibraryList view={libraryViewOf(null, 'Rae', CLOCK)} {...NONE} />)).toBe('<p class="library-note" aria-busy="true">Loading the library…</p>')
  })

  it('turns every Save… and the older chats button off while a save is on its way', () => {
    const html = renderToStaticMarkup(<LibraryList view={libraryViewOf(pages(), 'Rae', CLOCK)} {...NONE} busy={NOTES.id} />)
    expect(html).toContain('<li class="library-item" aria-busy="true">')
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(3)
  })
})

const CSS = readFileSync(new URL('../src/renderer/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const ruleOf = (selector: string): string =>
  [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([, prelude]) => prelude!.split(',').map(part => part.trim()).includes(selector))?.[2] ?? ''

describe('the Library tab in the details panel', () => {
  it("draws its Save… and Look in older chats as the panel's Upload picture button, at rest and under the pointer", () => {
    expect(ruleOf('.library-controls button')).toBe(ruleOf('.bot-picture button'))
    expect(ruleOf('.library-older')).toBe(ruleOf('.bot-picture button'))
    expect(ruleOf('.library-controls button:hover:not(:disabled)')).toBe(ruleOf('.bot-picture button:hover:not(:disabled)'))
  })

  it('hides the Details fields under every tab but Details, keeping the tab row and the tab', () => {
    expect(CSS).toContain('.bot-panel.off-details .bot-form-body > :not(.bot-tabs, .bot-new, .bots-warned, .bot-tab)')
    expect(CSS).not.toContain('.on-routines')
  })
})

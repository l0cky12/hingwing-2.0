import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@highwing/hermes/domain'
import { TRAY_ICON_PNG } from '../src/main/tray-icon'
import { decideClose, trayView } from '../src/main/tray-view'

const row = (id: string, title: string, badge: 'none' | 'running' | 'asking') => ({ id: id as SessionId, title, badge })
const show = { kind: 'action', label: 'Show Highwing', action: { do: 'raise' } }
const bar = { kind: 'separator' }
const quit = { kind: 'action', label: 'Quit', action: { do: 'quit' } }
const open = (id: string, label: string) => ({ kind: 'action', label, action: { do: 'open', sessionId: id as SessionId } })

describe('trayView', () => {
  it('offers Show Highwing and Quit when no chat is waiting', () => {
    const expected = { count: 0, tooltip: 'Highwing', items: [show, bar, quit] }
    expect(trayView([])).toEqual(expected)
    expect(trayView([row('a', 'Alpha', 'running'), row('b', 'Beta', 'none')])).toEqual(expected)
  })

  it('lists the asking chats in sidebar order and leaves a running chat out', () => {
    expect(trayView([
      row('a', 'Alpha', 'asking'),
      row('b', 'Beta', 'running'),
      row('c', 'Gamma', 'none'),
      row('d', 'Delta', 'asking')
    ])).toEqual({
      count: 2,
      tooltip: '2 chats waiting for your OK',
      items: [show, bar, open('a', 'Alpha'), open('d', 'Delta'), bar, quit]
    })
  })

  it('says one chat when a single chat is waiting', () => {
    expect(trayView([row('a', 'Alpha', 'asking')])).toEqual({
      count: 1,
      tooltip: '1 chat waiting for your OK',
      items: [show, bar, open('a', 'Alpha'), bar, quit]
    })
  })

  it('shows Untitled chat for a blank title', () => {
    expect(trayView([row('a', '', 'asking'), row('b', '   ', 'asking')]).items).toEqual([
      show, bar, open('a', 'Untitled chat'), open('b', 'Untitled chat'), bar, quit
    ])
  })

  it('lists two waiting chats that share a title', () => {
    expect(trayView([row('a', 'Notes', 'asking'), row('b', 'Notes', 'asking')]).items).toEqual([
      show, bar, open('a', 'Notes'), open('b', 'Notes'), bar, quit
    ])
  })
})

describe('the tray icon bytes', () => {
  it('embeds the committed png, so the built main shows the same wing', () => {
    expect(Buffer.from(TRAY_ICON_PNG).equals(readFileSync(new URL('../src/main/tray-icon.png', import.meta.url)))).toBe(true)
  })
})

describe('decideClose', () => {
  it('hides only when the preference is stay, the tray is up, and the window itself is closing', () => {
    const preferences = ['stay', 'quit'] as const
    const intents = ['window', 'quit'] as const
    const decided = preferences.flatMap(preference => [true, false].flatMap(trayAlive => intents.map(intent => (
      [preference, trayAlive, intent, decideClose({ preference, trayAlive, intent })] as const
    ))))
    expect(decided.filter(([, , , decision]) => decision === 'hide')).toEqual([['stay', true, 'window', 'hide']])
    expect(decided.filter(([, , , decision]) => decision === 'quit')).toHaveLength(7)
  })
})

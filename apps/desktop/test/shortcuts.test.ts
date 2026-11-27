import { describe, expect, it } from 'vitest'
import { botBeside, capsOf, matches, SHORTCUTS, shortcutOf, type Shortcut } from '../src/renderer/shortcuts'

interface Press { key: string; code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }

const press = (key: string, mods: Partial<Omit<Press, 'key' | 'code'>> = {}, code = ''): Press =>
  ({ key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })

/** The press that is this shortcut on this platform, with `key` the first one it matches. */
const pressOf = (shortcut: Shortcut, mac: boolean, key = shortcut.keys[0] ?? ''): Press =>
  press(key, {
    ctrlKey: shortcut.mod === 'ctrl' || (shortcut.mod === 'command' && !mac),
    metaKey: shortcut.mod === 'command' && mac,
    altKey: shortcut.mod === 'alt',
    shiftKey: shortcut.shift === true
  })

const byId = (id: Shortcut['id']) => SHORTCUTS.find(shortcut => shortcut.id === id)!

describe.each([false, true])('the shortcut table (mac: %s)', mac => {
  it.each(SHORTCUTS.map(shortcut => [shortcut.id, shortcut] as const))('%s matches its own key press', (id, shortcut) => {
    for (const key of shortcut.keys) {
      expect(shortcutOf(pressOf(shortcut, mac, key), mac)?.id).toBe(id)
    }
  })

  it('reads the digit of Cmd or Ctrl and 1 to 9', () => {
    expect(shortcutOf(pressOf(byId('bot'), mac, '1'), mac)).toEqual({ id: 'bot', digit: 1 })
    expect(shortcutOf(pressOf(byId('bot'), mac, '9'), mac)).toEqual({ id: 'bot', digit: 9 })
    expect(shortcutOf(pressOf(byId('bot'), mac, '0'), mac)?.id).toBe('zoomReset')
  })

  it('keeps Ctrl+Tab on Ctrl, and Shift turns it around', () => {
    expect(shortcutOf(press('Tab', { ctrlKey: true }), mac)).toEqual({ id: 'cycleBot', digit: null })
    expect(shortcutOf(press('Tab', { ctrlKey: true, shiftKey: true }), mac)).toEqual({ id: 'cycleBotBack', digit: null })
    expect(shortcutOf(press('Tab', { metaKey: true }), mac)).toBeNull()
  })

  it('tells Shift+N, a group chat, from N, a chat', () => {
    expect(shortcutOf(pressOf(byId('newChat'), mac, 'n'), mac)?.id).toBe('newChat')
    expect(shortcutOf({ ...pressOf(byId('newChat'), mac, 'N'), shiftKey: true }, mac)?.id).toBe('newGroup')
  })

  it('takes Alt+Arrow only without Ctrl, Cmd or Shift', () => {
    expect(shortcutOf(press('ArrowUp', { altKey: true }), mac)?.id).toBe('previousBot')
    expect(shortcutOf(press('ArrowDown', { altKey: true }), mac)?.id).toBe('nextBot')
    expect(shortcutOf(press('ArrowDown', { altKey: true, ctrlKey: true }), mac)).toBeNull()
    expect(shortcutOf(press('ArrowDown', { altKey: true, metaKey: true }), mac)).toBeNull()
    expect(shortcutOf(press('ArrowDown', { altKey: true, shiftKey: true }), mac)).toBeNull()
  })

  it('zooms in on = and on + with or without Shift', () => {
    expect(shortcutOf(pressOf(byId('zoomIn'), mac, '='), mac)?.id).toBe('zoomIn')
    expect(shortcutOf({ ...pressOf(byId('zoomIn'), mac, '+'), shiftKey: true }, mac)?.id).toBe('zoomIn')
  })

  it('matches nothing with the wrong modifiers', () => {
    expect(shortcutOf(press('k', { altKey: true, ctrlKey: true, metaKey: mac }), mac)).toBeNull()
    expect(shortcutOf(press('k', { ctrlKey: true, metaKey: true }), mac)).toBeNull()
    expect(shortcutOf(press('k', { ctrlKey: true, shiftKey: true }), mac)).toBeNull()
    expect(shortcutOf(press('k'), mac)).toBeNull()
  })

  it('reads a letter by the key when the layout types a Latin one, and by its place when it does not', () => {
    expect(shortcutOf({ ...pressOf(byId('palette'), mac, 'л'), code: 'KeyK' }, mac)?.id).toBe('palette')
    expect(shortcutOf({ ...pressOf(byId('palette'), mac, 'л'), code: 'KeyJ' }, mac)).toBeNull()
    expect(shortcutOf({ ...pressOf(byId('palette'), mac, 'j'), code: 'KeyK' }, mac)).toBeNull()
  })

  it('never lets two rows match one press', () => {
    const keys = [...new Set(SHORTCUTS.flatMap(shortcut => shortcut.keys)), 'A', 'N', 'Tab', 'Enter']
    for (const key of keys) {
      for (let bits = 0; bits < 16; bits++) {
        const one = press(key, { ctrlKey: (bits & 1) !== 0, metaKey: (bits & 2) !== 0, altKey: (bits & 4) !== 0, shiftKey: (bits & 8) !== 0 })
        expect(SHORTCUTS.filter(shortcut => matches(shortcut, one, mac)).length, `${key} ${bits}`).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('Cmd on macOS and Ctrl elsewhere', () => {
  it('reads Ctrl+K elsewhere and Cmd+K on macOS only', () => {
    expect(shortcutOf(press('k', { ctrlKey: true }), false)?.id).toBe('palette')
    expect(shortcutOf(press('k', { metaKey: true }), false)).toBeNull()
    expect(shortcutOf(press('k', { metaKey: true }), true)?.id).toBe('palette')
    expect(shortcutOf(press('k', { ctrlKey: true }), true)).toBeNull()
  })

  it('reads Ctrl+1 elsewhere and Cmd+1 on macOS as digit 1', () => {
    expect(shortcutOf(press('1', { ctrlKey: true }), false)).toEqual({ id: 'bot', digit: 1 })
    expect(shortcutOf(press('1', { metaKey: true }), true)).toEqual({ id: 'bot', digit: 1 })
  })
})

describe('capsOf', () => {
  it('draws Cmd on macOS and Ctrl elsewhere', () => {
    expect(capsOf(byId('palette'), true)).toEqual(['⌘', 'K'])
    expect(capsOf(byId('palette'), false)).toEqual(['Ctrl', 'K'])
  })

  it('draws Ctrl+Tab with Ctrl on macOS too', () => {
    expect(capsOf(byId('cycleBot'), true)).toEqual(['Ctrl', 'Tab'])
    expect(capsOf(byId('cycleBotBack'), false)).toEqual(['Ctrl', 'Shift', 'Tab'])
  })

  it('draws Alt, Shift and the digits', () => {
    expect(capsOf(byId('nextBot'), false)).toEqual(['Alt', '↓'])
    expect(capsOf(byId('nextBot'), true)).toEqual(['⌥', '↓'])
    expect(capsOf(byId('newGroup'), true)).toEqual(['⌘', '⇧', 'N'])
    expect(capsOf(byId('bot'), false)).toEqual(['Ctrl', '1–9'])
  })

  it('marks the group chat shortcut as bot mode only', () => {
    expect(byId('newGroup').onlyIn).toBe('In bot mode')
  })
})

describe('botBeside', () => {
  const order = ['a', 'b', 'c']

  it.each([
    ['steps on', 'b', 1, false, 'c'],
    ['steps back', 'b', -1, false, 'a'],
    ['stops at the end', 'c', 1, false, null],
    ['stops at the start', 'a', -1, false, null],
    ['wraps forward', 'c', 1, true, 'a'],
    ['wraps back', 'a', -1, true, 'c'],
    ['starts at the first going forward with none selected', null, 1, false, 'a'],
    ['starts at the last going back with none selected', null, -1, true, 'c']
  ] as const)('%s', (_what, current, by, wrap, expected) => {
    expect(botBeside(order, current, by, wrap)).toBe(expected)
  })

  it('has nowhere to go with no bots', () => {
    expect(botBeside([], null, 1, true)).toBeNull()
  })
})

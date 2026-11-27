import { describe, expect, it } from 'vitest'
import { isSettingsChord } from '../src/renderer/keys'

const chord = (over: Partial<KeyboardEvent> = {}): KeyboardEvent => ({
  key: ',',
  code: 'Comma',
  repeat: false,
  isComposing: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ctrlKey: true,
  ...over
} as KeyboardEvent)

describe('Ctrl+Comma', () => {
  it('is the Settings chord', () => {
    expect(isSettingsChord(chord())).toBe(true)
    expect(isSettingsChord(chord({ key: 'a', code: 'Comma' }))).toBe(true)
  })

  it.each([
    ['Shift', { shiftKey: true }],
    ['Alt', { altKey: true }],
    ['a letter', { key: 'k', code: 'KeyK' }],
    ['a key repeat', { repeat: true }],
    ['a composition', { isComposing: true }],
    ['no Ctrl', { ctrlKey: false }]
  ] as const)('ignores %s', (_what, over) => {
    expect(isSettingsChord(chord(over))).toBe(false)
  })
})

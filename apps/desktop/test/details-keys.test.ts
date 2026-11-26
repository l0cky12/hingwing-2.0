import { describe, expect, it } from 'vitest'
import { detailsKeys, isDetailsKey } from '../src/renderer/keys'

const press = (code: string, held: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>>) =>
  ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...held })

describe('the details shortcut', () => {
  it('is Ctrl+Alt+B on Linux and Windows, however the layout types it', () => {
    expect(isDetailsKey(press('KeyB', { ctrlKey: true, altKey: true }), false)).toBe(true)
    expect(isDetailsKey(press('KeyB', { ctrlKey: true }), false)).toBe(false)
    expect(isDetailsKey(press('KeyB', { ctrlKey: true, altKey: true, shiftKey: true }), false)).toBe(false)
    expect(isDetailsKey(press('KeyI', { ctrlKey: true, altKey: true }), false)).toBe(false)
    expect(isDetailsKey(press('KeyB', { metaKey: true, shiftKey: true }), false)).toBe(false)
  })

  it('is Cmd+Shift+I on macOS', () => {
    expect(isDetailsKey(press('KeyI', { metaKey: true, shiftKey: true }), true)).toBe(true)
    expect(isDetailsKey(press('KeyI', { metaKey: true }), true)).toBe(false)
    expect(isDetailsKey(press('KeyI', { metaKey: true, shiftKey: true, altKey: true }), true)).toBe(false)
    expect(isDetailsKey(press('KeyB', { ctrlKey: true, altKey: true }), true)).toBe(false)
  })

  it('names itself for the screen and for assistive technology', () => {
    expect(detailsKeys(false)).toEqual({ shown: 'Ctrl+Alt+B', aria: 'Control+Alt+B' })
    expect(detailsKeys(true)).toEqual({ shown: '⌘⇧I', aria: 'Meta+Shift+I' })
  })
})

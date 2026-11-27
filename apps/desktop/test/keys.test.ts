import { describe, expect, it } from 'vitest'
import { COMMAND_KEY, MAC, SEND_KEY_LABEL, sendsMessage } from '../src/renderer/keys'

const press = (more: Partial<Record<'key' | 'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey', boolean | string>> = {}) =>
  ({ key: 'Enter', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...more }) as Parameters<typeof sendsMessage>[0]
const MOD = MAC ? { metaKey: true } : { ctrlKey: true }
const OTHER_MOD = MAC ? { ctrlKey: true } : { metaKey: true }

describe('which key sends', () => {
  it('sends on Enter and leaves Shift+Enter for a new line when Enter sends', () => {
    expect(sendsMessage(press(), 'enter')).toBe(true)
    expect(sendsMessage(press({ shiftKey: true }), 'enter')).toBe(false)
  })

  it('sends on no other key when Enter sends', () => {
    expect(sendsMessage(press({ key: 'a' }), 'enter')).toBe(false)
    expect(sendsMessage(press({ key: 'Tab' }), 'enter')).toBe(false)
  })

  it('sends on the command key with Enter, and leaves plain Enter for a new line, when the command key sends', () => {
    expect(sendsMessage(press(MOD), 'modEnter')).toBe(true)
    expect(sendsMessage(press(), 'modEnter')).toBe(false)
  })

  it('does not send on Shift, Alt or the other platform modifier added to the command key', () => {
    expect(sendsMessage(press({ ...MOD, shiftKey: true }), 'modEnter')).toBe(false)
    expect(sendsMessage(press({ ...MOD, altKey: true }), 'modEnter')).toBe(false)
    expect(sendsMessage(press({ ...MOD, ...OTHER_MOD }), 'modEnter')).toBe(false)
    expect(sendsMessage(press(OTHER_MOD), 'modEnter')).toBe(false)
  })

  it('sends on no other key when the command key sends', () => {
    expect(sendsMessage(press({ ...MOD, key: 'a' }), 'modEnter')).toBe(false)
  })

  it('names the sending key the way the keyboard shortcuts name the command key', () => {
    expect(SEND_KEY_LABEL).toEqual({ enter: 'Enter', modEnter: `${COMMAND_KEY}+Enter` })
  })
})

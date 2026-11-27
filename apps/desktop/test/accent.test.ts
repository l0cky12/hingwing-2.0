import type { Bots } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { accentTone, toneOfBot } from '../src/renderer/chrome/accent'

describe('the tone an accent paints', () => {
  it('is the open bot’s tone when the accent follows the bot', () => {
    expect(accentTone('bot', 'plum')).toBe('plum')
  })

  it('is none when the accent follows the bot and the chat has no bot, so the chat keeps its untinted look', () => {
    expect(accentTone('bot', null)).toBeNull()
  })

  it.each(['ink', 'slate', 'plum', 'olive', 'mauve', 'umber'] as const)('is %s when the user fixed it, whatever bot is open', fixed => {
    expect(accentTone(fixed, 'umber')).toBe(fixed)
    expect(accentTone(fixed, null)).toBe(fixed)
  })
})

describe('the tone of a bot in the roster', () => {
  const bot = (id: string, tone: 'slate' | 'plum') => ({ id, name: id, preview: null, description: null, tone, picture: null, pinned: false, hidden: false })
  const listed = { state: 'listed', roster: { featured: bot('main', 'slate'), sections: [{ bots: [bot('ada', 'plum')] }] } } as unknown as Bots

  it('finds a featured bot and a bot in a section', () => {
    expect(toneOfBot(listed, 'main' as never)).toBe('slate')
    expect(toneOfBot(listed, 'ada' as never)).toBe('plum')
  })

  it('is null with no bot, an unlisted bot, or a roster still loading', () => {
    expect(toneOfBot(listed, null)).toBeNull()
    expect(toneOfBot(listed, 'zed' as never)).toBeNull()
    expect(toneOfBot({ state: 'loading' }, 'ada' as never)).toBeNull()
    expect(toneOfBot(undefined, 'ada' as never)).toBeNull()
  })
})

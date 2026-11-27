import { describe, expect, it } from 'vitest'
import { closedWords, CONTROL_WORDS, NO_SCREEN_WORDS, pressOf } from '../src/renderer/computer/computer'

describe('the computer view', () => {
  it('says plainly when this Hermes cannot show its screen, or the agent is not using one', () => {
    expect(NO_SCREEN_WORDS.unavailable).toBe("This Hermes can't show its screen.")
    expect(NO_SCREEN_WORDS.off).toBe("Hermes isn't using its screen right now.")
  })

  it('offers to take control from whoever has it, and to hand it back once the user has it', () => {
    expect([pressOf('agent'), pressOf('someone'), pressOf('you')]).toEqual([
      { label: 'Take control', take: true }, { label: 'Take control', take: true }, { label: 'Hand back', take: false }
    ])
    expect(CONTROL_WORDS).toEqual({ agent: 'Hermes has control', you: 'You have control', someone: 'Someone else has control' })
  })

  it('watches again when another person took control, and says why for any other close', () => {
    expect(closedWords(4000).again).toBe(true)
    expect(closedWords(4001)).toEqual({ words: 'The screen stopped.', again: false })
    expect(closedWords(1000)).toEqual({ words: 'The live view closed.', again: false })
    expect(closedWords(4404)).toEqual({ words: "Highwing couldn't reach the screen.", again: false })
  })
})

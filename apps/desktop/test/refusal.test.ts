import type { SessionId } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { refusalOnPane, type PaneRefusal } from '../src/renderer/chat/refusal'

const FIRST = 's1' as SessionId
const LATER = 's2' as SessionId

describe('a refusal on this pane', () => {
  it('keeps a refusal from an unstarted chat on the session that chat gained, and hides it on a different session', () => {
    const recorded: PaneRefusal = { id: null, message: 'nope' }
    expect(refusalOnPane(null, FIRST)).toBeNull()
    expect(refusalOnPane(recorded, null)).toBe(recorded)
    const bound = refusalOnPane(recorded, FIRST)
    expect(bound).toEqual({ id: FIRST, message: 'nope' })
    expect(refusalOnPane(bound, FIRST)).toBe(bound)
    expect(refusalOnPane(bound, LATER)).toBeNull()
    expect(refusalOnPane({ id: FIRST, message: 'nope' }, LATER)).toBeNull()
  })
})

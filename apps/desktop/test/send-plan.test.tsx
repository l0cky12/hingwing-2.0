import { offeredBy, sendPlan, type Generation, type SendPlan, type TurnId } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'

describe('the composer and queue rows, read from the domain', () => {
  it('steer a message into a running turn when the chat says steer', () => {
    const plan: SendPlan = sendPlan({
      run: { state: 'running', generation: 4 as Generation, stop: 'none', turn: { id: 't1' as TurnId, request: null, began: null, items: [], announced: null } },
      requests: [],
      tuning: { reasoning: null, busy: 'steer', effort: null, fast: null, yolo: null }
    }, [])
    expect(plan).toEqual({ by: 'steer', during: 4 })
  })

  it('offer a queued row what Hermes lets it do, and a lost row only its release', () => {
    expect(offeredBy({ s: 'queued', can: ['sendNow'] })).toEqual(['cancel', 'sendNow'])
    expect(offeredBy({ s: 'lost', generation: 7 as Generation })).toEqual(['release'])
  })
})

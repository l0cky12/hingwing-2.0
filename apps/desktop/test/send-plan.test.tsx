import { offeredBy, sendPlan, type Generation, type SendPlan, type SlashCatalog, type TurnId } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { busyHint } from '../src/renderer/composer/busy'

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

describe('the line under the composer while Hermes works', () => {
  const catalog: SlashCatalog = [{ kind: 'command', name: 'busy', description: 'Control how messages behave while Hermes is working' }]

  it('says a steered send is read after the current step, and a redirect stops it', () => {
    expect(busyHint('steer', 'Use ISO dates.', catalog)).toBe('Hermes is working. It reads this after its current step.')
    expect(busyHint('redirect', '', catalog)).toBe('Hermes is working. It stops this step to read this.')
  })

  it('says nothing when the send queues, or when the line runs a command', () => {
    expect(busyHint('submit', 'Use ISO dates.', catalog)).toBeNull()
    expect(busyHint('steer', '/busy queue', catalog)).toBeNull()
    expect(busyHint('steer', '/unlisted words', catalog)).toBe('Hermes is working. It reads this after its current step.')
  })
})

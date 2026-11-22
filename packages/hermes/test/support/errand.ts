import { fileURLToPath } from 'node:url'
import { loadFixture, type Fixture, type FixtureStep } from '../../src/testing/fixture'

export const ERRAND = loadFixture(fileURLToPath(new URL('../../../../fixtures/errand.jsonl', import.meta.url)))
export const SESSION = ERRAND.header.sessionId

export const stepOf = (method: string) => ERRAND.steps.findIndex(step => 'await' in step && step.await === method)
export const paramsOf = (method: string) => (ERRAND.steps[stepOf(method)] as Extract<FixtureStep, { await: string }>).params as Record<string, unknown>

/** The errand with Hermes asking this client for a sudo password after `afterPush` pushes. */
export function withSudo(afterPush: number): Fixture {
  const pushes = ERRAND.steps.flatMap((step, index) => ('push' in step ? [index] : []))
  const at = pushes[afterPush - 1] as number
  const request = { jsonrpc: '2.0', id: 'srq-0123456789ab', method: 'sudo', params: { session_id: SESSION, command: 'sudo true' } }
  return { ...ERRAND, steps: [...ERRAND.steps.slice(0, at + 1), { at: ERRAND.steps[at]?.at ?? 0, push: request }, ...ERRAND.steps.slice(at + 1)] }
}

export interface Sent { readonly method: string; readonly params?: Record<string, unknown> }

/** The calls a client made, without the heartbeat. */
export const callsIn = (received: readonly unknown[]): Sent[] =>
  received.flatMap(frame => {
    const { method, params } = frame as Partial<Sent>
    return method === undefined || method === 'gateway.ping' ? [] : [{ method, ...(params === undefined ? {} : { params }) }]
  })

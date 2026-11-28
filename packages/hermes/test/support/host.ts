import { afterEach } from 'vitest'
import { settle } from '../../src/testing/clock'
import { fakeHost, type FakeHost, type Gateway, type Hold, type ScenarioName } from '../../src/testing/fake-host'
import { RING_FRAMES, ScriptedGateway } from '../../src/testing/gateway'
import { loopback, type Loopback } from '../../src/testing/loopback'
import { systemClock } from '../../src/wire/link'
import { ERRAND } from './errand'

const closers: (() => unknown)[] = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
})

/** Runs `close` after the test, last opened first. */
export const closing = <T>(held: T, close: (held: T) => unknown): T => {
  closers.push(() => close(held))
  return held
}

export const errandGateway = () => new ScriptedGateway(ERRAND, { clock: systemClock, timing: 'instant', ringFrames: RING_FRAMES, drop: null })

export const listen = async (gateway: ScriptedGateway): Promise<Loopback> => closing(await loopback(gateway, systemClock), held => held.close())

export const host = async (name: ScenarioName, gateway: Gateway | null = null, holdAt?: Hold): Promise<FakeHost> =>
  closing(await fakeHost(name, gateway, holdAt === undefined ? {} : { holdAt }), held => held.close())

const PATIENCE_MS = 10_000

/** Lets a test that starts processes wait out several `until`s, so `until` names what never happened before vitest gives up. */
export const PATIENT_TEST_MS = 3 * PATIENCE_MS

/** Waits for something another process does. Fails with `what` when it never happens. */
export async function until(what: string, happened: () => boolean): Promise<void> {
  const deadline = systemClock.now() + PATIENCE_MS
  while (!happened()) {
    if (systemClock.now() > deadline) throw new Error(`gave up waiting for ${what}`)
    await settle()
  }
}

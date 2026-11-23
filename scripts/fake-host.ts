/**
 * Runs the fake Hermes machine for a verify run: `tsx scripts/fake-host.ts <scenario> <fixture> [hold]`.
 * It prints one JSON line naming the bin directory of the fake tools, then serves until it is killed.
 * The gateway behind it plays `fixture` at its recorded pace.
 */
import { fakeHost, FAKE_HOST, SCENARIOS, type Hold, type ScenarioName } from '../packages/hermes/src/testing/fake-host'
import { loadFixture } from '../packages/hermes/src/testing/fixture'
import { RING_FRAMES, ScriptedGateway } from '../packages/hermes/src/testing/gateway'
import { loopback } from '../packages/hermes/src/testing/loopback'
import { systemClock } from '../packages/hermes/src/wire/link'

const HOLDS: readonly Hold[] = ['tailscale', 'ssh', 'attach', 'relay']

const [scenario, fixture, hold] = process.argv.slice(2)
if (scenario === undefined || !Object.hasOwn(SCENARIOS, scenario) || fixture === undefined || (hold !== undefined && !HOLDS.includes(hold as Hold))) {
  console.error(`usage: fake-host.ts <${Object.keys(SCENARIOS).join('|')}> <fixture> [${HOLDS.join('|')}]`)
  process.exit(2)
}

const gateway = new ScriptedGateway(loadFixture(fixture), { clock: systemClock, timing: 'recorded', ringFrames: RING_FRAMES, drop: null })
const host = await fakeHost(scenario as ScenarioName, await loopback(gateway, systemClock), hold === undefined ? {} : { holdAt: hold as Hold })
console.log(JSON.stringify({ bin: host.bin, host: FAKE_HOST }))

/**
 * Runs the fake Hermes machine for a verify run: `tsx scripts/fake-host.ts <scenario> <fixture> [hold]`.
 * It prints one JSON line naming the bin directory of the fake tools, then serves until it is killed.
 * The gateway behind it plays `fixture` at its recorded pace, and appends each frame it is sent, masked, to the file
 * `HIGHWING_FIXTURE_CALLS` names. A fixture with `files` also serves Hermes's download route on the gateway's HTTP listener.
 */
import { appendFileSync } from 'node:fs'
import { fakeHost, FAKE_HOST, SCENARIOS, type Hold, type ScenarioName } from '../packages/hermes/src/testing/fake-host'
import { ticketedFiles } from '../packages/hermes/src/testing/files'
import { loadFixture, maskedFrame } from '../packages/hermes/src/testing/fixture'
import { RING_FRAMES, ScriptedGateway } from '../packages/hermes/src/testing/gateway'
import { loopback } from '../packages/hermes/src/testing/loopback'
import { systemClock } from '../packages/hermes/src/wire/link'

const HOLDS: readonly Hold[] = ['tailscale', 'ssh', 'attach', 'relay']

const [scenario, fixture, hold] = process.argv.slice(2)
if (scenario === undefined || !Object.hasOwn(SCENARIOS, scenario) || fixture === undefined || (hold !== undefined && !HOLDS.includes(hold as Hold))) {
  console.error(`usage: fake-host.ts <${Object.keys(SCENARIOS).join('|')}> <fixture> [${HOLDS.join('|')}]`)
  process.exit(2)
}

const calls = process.env.HIGHWING_FIXTURE_CALLS
const played = loadFixture(fixture)
const gateway = new ScriptedGateway(played, {
  clock: systemClock, timing: 'recorded', ringFrames: RING_FRAMES, drop: null,
  ...(calls ? { onReceived: (frame: unknown) => appendFileSync(calls, `${JSON.stringify(maskedFrame(frame))}\n`) } : {})
})
const listener = await loopback(gateway, systemClock)
const { files, chats = {} } = played.header
if (files !== undefined) listener.front(ticketedFiles(listener, { files, chats }))
const host = await fakeHost(scenario as ScenarioName, listener, { ...(hold === undefined ? {} : { holdAt: hold as Hold }), ...(files === undefined ? {} : { http: listener }) })
console.log(JSON.stringify({ bin: host.bin, host: FAKE_HOST }))

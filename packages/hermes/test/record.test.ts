import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PromptId } from '../src/domain/session'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { loadFixture, playToEnd, recordingDialer, scriptedDialer, type FixtureStep } from '../src/testing/fixture'
import { ERRAND, paramsOf, PROFILES, SESSION, SLASH } from './support/errand'

async function record(drop?: { afterPush: number; missed: number }, fixture = ERRAND) {
  const path = join(mkdtempSync(join(tmpdir(), 'highwing-record-')), 'errand.jsonl')
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock, timing: 'recorded', ...(drop === undefined ? {} : { drop }) })
  const hermes = openHermes({
    dial: recordingDialer(script, path, clock), clock, client: { name: 'highwing-test', version: '0' },
    mintId: () => String(paramsOf('prompt.submit').input_id)
  })
  hermes.watch(SESSION, () => {})
  await clock.advance(0)
  await hermes.run({ do: 'send', sessionId: SESSION, text: String(paramsOf('prompt.submit').text) })
  await clock.advance(5_000)
  await hermes.run({ do: 'answer', sessionId: SESSION, promptId: paramsOf('approval.respond').prompt_id as PromptId, reply: { kind: 'choice', value: 'once' } })
  await clock.advance(5_000)
  expect(script.finished).toBe(true)
  await hermes.close()
  return path
}

const kindOf = (step: FixtureStep) => ('push' in step ? 'push' : 'await' in step ? `await ${step.await}` : 'stored' in step ? 'stored' : 'drop')

describe('recordingDialer', () => {
  it('writes a fixture that plays back to the same session', async () => {
    const recorded = loadFixture(await record())
    expect(recorded.header).toMatchObject({ fixture: 1, source: 'recorded', sessionId: SESSION, stored: [], describe: ERRAND.header.describe })
    expect(recorded.steps.map(kindOf)).toEqual(ERRAND.steps.filter(step => !('stored' in step)).map(kindOf))
    const calls = (steps: readonly FixtureStep[]) => steps.flatMap(step => ('await' in step ? [{ await: step.await, params: step.params, reply: step.reply }] : []))
    expect(calls(recorded.steps)).toEqual(calls(ERRAND.steps))
    expect(await playToEnd(recorded)).toEqual(await playToEnd(ERRAND))
  })

  it('keeps recorded time between frames', async () => {
    const { steps } = loadFixture(await record())
    const ask = steps.findIndex(step => 'await' in step && step.await === 'approval.respond')
    expect((steps[ask - 1]?.at ?? 0) - (steps[1]?.at ?? 0), 'the turn up to the approval took as long as in the errand').toBe(702)
  })

  it('records a lost socket as a drop step, and the frames a replay delivered as pushes', async () => {
    const recorded = loadFixture(await record({ afterPush: 10, missed: 3 }))
    expect(recorded.steps.filter(step => 'drop' in step)).toMatchObject([{ drop: 1006 }])
    const seqs = recorded.steps.flatMap(step => ('push' in step ? [(step.push as { params: { seq: number } }).params.seq] : []))
    expect(seqs).toEqual(seqs.map((_seq, index) => index + 1))
    expect(seqs).toHaveLength(ERRAND.steps.filter(step => 'push' in step).length)
    expect(await playToEnd(recorded), 'the recording replays, drop included').toEqual(await playToEnd(ERRAND))
  })

  it('keeps the bots and the slash catalog in the header, out of the story, so the recording plays to the end', async () => {
    const { catalog } = SLASH.header
    const recorded = loadFixture(await record(undefined, { ...ERRAND, header: { ...ERRAND.header, profiles: PROFILES, catalog } }))
    expect(recorded.header).toMatchObject({ profiles: PROFILES, catalog })
    expect(recorded.steps.map(kindOf)).toEqual(ERRAND.steps.filter(step => !('stored' in step)).map(kindOf))
    expect(await playToEnd(recorded)).toEqual(await playToEnd(ERRAND))
  })

  it('writes no handshake, heartbeat or attach call, and nothing that looks like a ticket', async () => {
    const text = readFileSync(await record(), 'utf8')
    expect(text).not.toMatch(/gateway\.ping|client\.capabilities|"await":"session\.resume"|hermes-gateway-ticket/)
  })
})

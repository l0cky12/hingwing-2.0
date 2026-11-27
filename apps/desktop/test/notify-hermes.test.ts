import { readFileSync } from 'node:fs'
import { openHermes, type Hermes } from '@highwing/hermes'
import { shownChat, type BotId, type Command, type PromptId, type SessionId } from '@highwing/hermes/domain'
import { loadFixture, scriptedDialer, type Fixture, type FixtureStep } from '@highwing/hermes/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { OFF, type Intro } from '../src/intro'
import type { Notices, Setup } from '../src/ipc-contract'
import type { ConnectionOwner } from '../src/main/connection'
import { notify, type Notice } from '../src/main/notify'

const ERRAND = loadFixture('fixtures/errand.jsonl')
const STORY = ERRAND.header.sessionId
const paramsOf = (method: string) => (ERRAND.steps.find(step => 'await' in step && step.await === method) as Extract<FixtureStep, { await: string }>).params as Record<string, unknown>
const TEXT = String(paramsOf('prompt.submit').text)
const PROMPT = paramsOf('approval.respond').prompt_id as PromptId
const RESEARCH = 'research' as BotId
const RESEARCH_CHAT = 'local-0001' as SessionId

const ROSTER: unknown = JSON.parse(readFileSync('fixtures/profiles/roster.json', 'utf8'))
const CRON: NonNullable<Fixture['header']['cron']> = {
  jobs: [{ job_id: 'digest', name: 'Morning digest', schedule: '0 8 * * *', last_run_at: null, last_status: null }],
  runs: [{ after_ms: 0, job_id: 'digest', last_run_at: '2026-11-26T08:00:00', last_status: 'ok' }]
}
const FIXTURE: Fixture = { ...ERRAND, header: { ...ERRAND.header, profiles: ROSTER, cron: CRON } }
const ON: Notices = { asks: true, replies: true, jobs: true }

const closers: (() => unknown)[] = []
afterEach(async () => {
  for (const close of closers.splice(0).reverse()) await close()
})

/** Main's notifications for a Hermes on the scripted gateway, reached over a real socket, with the window focused on whatever `open` shows. */
function served(fixture: Fixture, kinds: Notices = ON) {
  const dial = scriptedDialer(fixture, { transport: 'loopback' })
  const hermes = openHermes({ dial, client: { name: 'highwing-test', version: '0.0.0' } })
  const shown: { notice: Notice; click: () => void }[] = []
  let raised = 0
  const setup = { get: (): Setup => ({ at: 'pinned' }), subscribe: () => () => {} }
  const owner = { setup, hermes: hermes as Hermes | null, run: ((command: Command) => hermes.run(command)) as ConnectionOwner['run'] }
  const intro = { get: (): Intro => OFF, subscribe: () => () => {} }
  const stop = notify(owner, intro, { notifier: { show: (notice, click) => shown.push({ notice, click }) }, focused: () => true, raise: () => void raised++, kinds: () => kinds })
  closers.push(() => hermes.close(), stop)
  return { hermes, shown, raised: () => raised }
}

const shownNow = (hermes: Hermes) => shownChat(hermes.open.get())?.sessionId ?? null

describe('notifications from a Hermes on the scripted gateway', () => {
  it('notifies an approval and the turn end in a chat that is not on screen, and a scheduled run, each once', async () => {
    const { hermes, shown, raised } = served(FIXTURE)
    await expect.poll(() => hermes.bots.get().state).toBe('listed')
    await hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    await expect.poll(() => shownNow(hermes)).toBe(RESEARCH_CHAT)
    await expect.poll(() => shown.map(({ notice }) => notice.title)).toEqual(['Scheduled job finished'])

    expect(await hermes.run({ do: 'send', sessionId: STORY, text: TEXT })).toEqual({ ok: true, value: null })
    await expect.poll(() => shown.map(({ notice }) => notice.title)).toEqual(['Scheduled job finished', 'Approval needed'])
    await hermes.run({ do: 'answer', sessionId: STORY, promptId: PROMPT, reply: { kind: 'choice', value: 'once' } })
    await expect.poll(() => shown.map(({ notice }) => notice.title)).toEqual(['Scheduled job finished', 'Approval needed', 'Hermes finished'])

    const byKind = (kind: Notice['kind']) => shown.find(({ notice }) => notice.kind === kind)!
    expect(byKind('asks').notice).toMatchObject({ key: `${STORY} ${PROMPT}`, opens: STORY })
    expect(byKind('replies').notice).toMatchObject({ opens: STORY, body: expect.stringMatching(/^Done\. I created/) })
    expect(byKind('jobs').notice).toEqual({ kind: 'jobs', key: 'digest 2026-11-26T08:00:00', opens: null, title: 'Scheduled job finished', body: 'Morning digest' })

    byKind('asks').click()
    await expect.poll(() => shownNow(hermes)).toBe(STORY)
    expect(raised()).toBe(1)
    byKind('jobs').click()
    expect(raised()).toBe(2)
    expect(shownNow(hermes), "a job's click opens no chat").toBe(STORY)
    expect(shown).toHaveLength(3)
  })

  it('shows nothing of a kind switched off', async () => {
    const { hermes, shown } = served(FIXTURE, { asks: false, replies: false, jobs: false })
    await expect.poll(() => hermes.bots.get().state).toBe('listed')
    await hermes.run({ do: 'open', ref: { kind: 'bot', bot: RESEARCH } })
    await expect.poll(() => shownNow(hermes)).toBe(RESEARCH_CHAT)
    await hermes.run({ do: 'send', sessionId: STORY, text: TEXT })
    await hermes.run({ do: 'answer', sessionId: STORY, promptId: PROMPT, reply: { kind: 'choice', value: 'once' } })
    await expect.poll(() => hermes.jobs.get()?.[0]?.ranAt).toBe('2026-11-26T08:00:00')
    expect(shown).toEqual([])
  })

  it('lists no jobs from a Hermes that does not serve cron.manage', async () => {
    const { hermes } = served(ERRAND)
    await expect.poll(() => hermes.link.get().state).toBe('online')
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(hermes.jobs.get()).toBeNull()
  })
})

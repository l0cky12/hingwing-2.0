import { describe, expect, it } from 'vitest'
import { hermesVersionOf } from '../src/domain/about'
import type { AccountReport, Outcome } from '../src/domain/command'
import { linesFromBars, linesFromInsights, parseAccountReport } from '../src/domain/usage'
import { play, type Fixture } from '../src/testing/fixture'
import { callsIn, ERRAND, SESSION } from './support/errand'

const headed = (extra: Partial<Fixture['header']>): Fixture => ({ ...ERRAND, header: { ...ERRAND.header, ...extra } })

async function asked(fixture: Fixture) {
  let result: Promise<Outcome<AccountReport>> | null = null
  let received: readonly unknown[] = []
  let version: string | null = null
  for await (const { hermes, session, script } of play(fixture)) {
    if (session.sync.state === 'live') {
      result ??= hermes.run({ do: 'accountUsage', sessionId: SESSION })
      const about = hermes.about.get()
      version = about.hermes.state === 'known' ? about.hermes.version : null
    }
    received = script.received
  }
  return { outcome: await result, received, version }
}

const usageCalls = (received: readonly unknown[]) =>
  callsIn(received).map(call => call.method).filter(method => method === 'session.account_usage' || method === 'usage.bars' || method === 'insights.get')

describe('what Hermes reports for the account', () => {
  it('reports the account lines, with the Nous lines after them, and does not ask again', async () => {
    const { outcome, received } = await asked(headed({
      accountUsage: { lines: [' Pro plan ', ''], nous_lines: ['', ' 12 left '], nous_route: false }
    }))
    expect(outcome).toEqual({ ok: true, value: { state: 'reported', lines: ['Pro plan', '12 left'] } })
    expect(usageCalls(received)).toEqual(['session.account_usage'])
  })

  it('reports an account that answered with no lines', async () => {
    const { outcome } = await asked(headed({ accountUsage: { lines: [' ', ''], nous_route: true } }))
    expect(outcome).toEqual({ ok: true, value: { state: 'reported', lines: [] } })
  })

  it('reports the balance bars when the account read is missing', async () => {
    const { outcome, received } = await asked(headed({
      usageBars: {
        available: true,
        plan_name: 'Pro',
        subscription_remaining_display: ' ',
        plan_bar: { remaining_display: '$4', total_display: '$20' }
      }
    }))
    expect(outcome).toEqual({ ok: true, value: { state: 'reported', lines: ['Pro', '$4 of $20'] } })
    expect(usageCalls(received)).toEqual(['session.account_usage', 'usage.bars'])
  })

  it('reports the insight counts when the bars are missing or unavailable', async () => {
    const { outcome, received } = await asked(headed({
      usageBars: { available: false },
      insights: { days: 7, sessions: 3, messages: 11 }
    }))
    expect(outcome).toEqual({ ok: true, value: { state: 'reported', lines: ['3 sessions', '11 messages', 'Last 7 days'] } })
    expect(usageCalls(received)).toEqual(['session.account_usage', 'usage.bars', 'insights.get'])
  })

  it('says nothing was reported when every read is missing', async () => {
    const { outcome, received } = await asked(ERRAND)
    expect(outcome).toEqual({ ok: true, value: { state: 'unreported' } })
    expect(usageCalls(received)).toEqual(['session.account_usage', 'usage.bars', 'insights.get'])
  })
})

describe('the lines a usage reply becomes', () => {
  it('drops blank account lines and keeps an empty report', () => {
    expect(parseAccountReport({ lines: ['a', ' '], nous_lines: [''] })).toEqual({ state: 'reported', lines: ['a'] })
    expect(parseAccountReport({ lines: [] })).toEqual({ state: 'reported', lines: [] })
  })

  it('skips bars that are not available and formats the ones that are', () => {
    expect(linesFromBars({ available: false })).toBeNull()
    expect(linesFromBars({
      available: true,
      status: 'active',
      topup_bar: { remaining_display: '$1', total_display: '$1' }
    })).toEqual(['active', '$1 of $1'])
  })

  it('names the insight window', () => {
    expect(linesFromInsights({ days: 30, sessions: 1, messages: 2 })).toEqual(['1 sessions', '2 messages', 'Last 30 days'])
  })
})

describe('the Hermes version About can show', () => {
  it('keeps a non-empty version and drops anything else', () => {
    expect(hermesVersionOf(' 0.23.3 ')).toBe('0.23.3')
    expect(hermesVersionOf('  ')).toBeNull()
    expect(hermesVersionOf(null)).toBeNull()
    expect(hermesVersionOf(1)).toBeNull()
  })

  it('shows the version the attach snapshot carried', async () => {
    const { version } = await asked(ERRAND)
    expect(version).toBe('0.23.3')
  })

  it('shows no version when the snapshot carried none', async () => {
    const { version } = await asked(headed({ hermes: '' }))
    expect(version).toBeNull()
  })
})

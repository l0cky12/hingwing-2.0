import type { AccountReport, CommandOutcome } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { usageNeedsRead, usageView, type UsageAsk } from '../src/renderer/setup/usage-view'

const settled = (sessionId: string, outcome: CommandOutcome<AccountReport>): UsageAsk => ({ at: 'settled', sessionId, outcome })

describe('what the Usage section draws', () => {
  it('asks for an open chat before it reads', () => {
    expect(usageView(null, { at: 'idle' })).toEqual({ state: 'needs-chat' })
  })

  it('waits while the read for this chat has not settled', () => {
    expect(usageView('chat', { at: 'idle' })).toEqual({ state: 'reading' })
    expect(usageView('chat', { at: 'reading', sessionId: 'chat' })).toEqual({ state: 'reading' })
    expect(usageView('chat', settled('other', { ok: true, value: { state: 'unreported' } }))).toEqual({ state: 'reading' })
  })

  it('shows a refusal as the refusal, including a chat Hermes no longer has', () => {
    const message = 'Hermes no longer has this chat.'
    expect(usageView('chat', settled('chat', { ok: false, refusal: { kind: 'rejected', message } }))).toEqual({ state: 'failed', message })
  })

  it('shows a report, or that this Hermes does not report usage', () => {
    expect(usageView('chat', settled('chat', { ok: true, value: { state: 'reported', lines: ['Pro'] } }))).toEqual({ state: 'reported', lines: ['Pro'] })
    expect(usageView('chat', settled('chat', { ok: true, value: { state: 'unreported' } }))).toEqual({ state: 'unreported' })
  })

  it('reads an offline refusal again once the chat is live, and keeps every other settled read', () => {
    const offline = settled('chat', { ok: false, refusal: { kind: 'offline', message: "Highwing isn't connected to this chat right now." } })
    const reported = settled('chat', { ok: true, value: { state: 'unreported' } })
    expect(usageNeedsRead(null, true, { at: 'idle' })).toBe(false)
    expect(usageNeedsRead('chat', false, { at: 'idle' })).toBe(true)
    expect(usageNeedsRead('chat', false, offline)).toBe(false)
    expect(usageNeedsRead('chat', true, offline)).toBe(true)
    expect(usageNeedsRead('chat', true, reported)).toBe(false)
    expect(usageNeedsRead('chat', true, settled('chat', { ok: false, refusal: { kind: 'rejected', message: 'Hermes no longer has this chat.' } }))).toBe(false)
  })
})

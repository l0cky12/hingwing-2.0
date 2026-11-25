import { describe, expect, it } from 'vitest'
import type { Generation, PromptId, PromptItem, Session, TurnId } from '../../hermes/src/domain/session'
import { threadView, type PromptCard } from '../src/thread-view'

const CLOCK = { now: 1_800_000_000_000, timeZone: 'UTC' }

function session(items: readonly PromptItem[], live = true): Session {
  return {
    id: 's1' as Session['id'], title: '', cwd: null, history: [], earlier: 'none', outbox: [],
    model: { current: null, next: null, ask: null }, usage: { totals: null, context: null }, yolo: null,
    sync: live ? { state: 'live' } : { state: 'offline' },
    run: { state: 'running', generation: 1 as Generation, stop: 'none', turn: { id: 't1' as TurnId, request: { text: 'Deploy it', inputId: null, rowId: null }, began: null, items, announced: null } }
  }
}

const prompt = (ask: PromptItem['ask'], state: PromptItem['state'] = { s: 'waiting', error: null }): PromptItem =>
  ({ kind: 'prompt', id: 'p1' as PromptId, generation: 1 as Generation, ask, state })

const approval = (reason: string | null): PromptItem['ask'] =>
  ({ kind: 'approval', command: 'rm -rf scratch', reason, choices: ['once', 'session', 'always', 'deny'] })

function cardOf(item: PromptItem, live = true): PromptCard {
  const node = threadView(session([item], live), CLOCK).turns[0]?.nodes[0]
  if (node?.kind !== 'prompt') throw new Error(`expected a prompt, got ${node?.kind}`)
  return node.card
}

describe('Always allow', () => {
  it('asks a second time, naming the pattern Hermes flagged', () => {
    const card = cardOf(prompt(approval('delete in root path')))
    if (card.state !== 'asking') throw new Error('expected buttons')
    expect(card.buttons.map(button => [button.label, button.confirm])).toEqual([
      ['Run once', null],
      ['Allow in this chat', null],
      ['Always allow', {
        title: 'Always allow commands like this?',
        body: 'Hermes won\'t ask again for commands matching “delete in root path”, in this chat or any other.'
      }],
      ["Don't run", null]
    ])
  })

  it('names the command when Hermes flagged no pattern', () => {
    const card = cardOf(prompt(approval(null)))
    const always = card.state === 'asking' ? card.buttons.find(button => button.reply.value === 'always') : undefined
    expect(always?.confirm?.body).toBe('Hermes won\'t ask again for commands matching “rm -rf scratch”, in this chat or any other.')
  })
})

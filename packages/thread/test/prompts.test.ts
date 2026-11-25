import { describe, expect, it } from 'vitest'
import { sessionOf, type Tracked } from '../../hermes/src/domain/reduce'
import type { Generation, PromptId, PromptItem, PromptReply, Session, TurnId } from '../../hermes/src/domain/session'
import { choose, fold } from '../../hermes/test/support/story'
import { multiReply, outline, threadView, type PromptCard } from '../src/thread-view'

const CLOCK = { now: 1_800_000_000_000, timeZone: 'UTC' }

function session(items: readonly PromptItem[], live = true): Session {
  return {
    id: 's1' as Session['id'], title: '', cwd: null, history: [], earlier: 'none', interlude: [], requests: [], queue: [], outbox: [],
    model: { current: null, next: null, ask: null }, usage: { totals: null, context: null },
    tuning: { reasoning: null, busy: null, effort: null, fast: null, yolo: null }, sides: [], processes: null, control: null,
    sync: live ? { state: 'live' } : { state: 'offline' },
    run: { state: 'running', generation: 1 as Generation, stop: 'none', turn: { id: 't1' as TurnId, request: { text: 'Deploy it', inputId: null, rowId: null, attachments: [] }, began: null, items, announced: null } }
  }
}

const prompt = (ask: PromptItem['ask'], state: PromptItem['state'] = { s: 'waiting', error: null }): PromptItem =>
  ({ kind: 'prompt', id: 'p1' as PromptId, generation: 1 as Generation, ask, state, deadline: null })

const multi = (choices = ['staging', 'production', 'canary']): Extract<PromptItem['ask'], { kind: 'clarify' }> =>
  ({ kind: 'clarify', question: 'Where should it go?', choices, multi: true })

const approval = (reason: string | null): PromptItem['ask'] =>
  ({ kind: 'approval', command: 'rm -rf scratch', reason, choices: ['once', 'session', 'always', 'deny'] })

function cardOf(item: PromptItem, live = true): PromptCard {
  const node = threadView(session([item], live), CLOCK).turns[0]?.nodes[0]
  if (node?.kind !== 'prompt') throw new Error(`expected a prompt, got ${node?.kind}`)
  return node.card
}

const answered = (ask: PromptItem['ask'], reply: PromptReply) => {
  const card = cardOf(prompt(ask, { s: 'answered', reply }))
  return card.state === 'answered' ? card.words : null
}

describe('multiReply', () => {
  it('sends the checked labels as a JSON array, in the order they were checked', () => {
    expect(multiReply({ picked: ['production', 'staging'], other: '' })).toEqual({ kind: 'text', value: '["production","staging"]' })
  })

  it('adds the typed Other answer after the checked labels', () => {
    expect(multiReply({ picked: ['staging'], other: '  a preview box ' })).toEqual({ kind: 'text', value: '["staging","a preview box"]' })
  })

  it('sends typed words alone as plain text', () => {
    expect(multiReply({ picked: [], other: ' a preview box ' })).toEqual({ kind: 'text', value: 'a preview box' })
  })

  it('has nothing to send when nothing is checked or typed', () => {
    expect(multiReply({ picked: [], other: '   ' })).toBeNull()
  })
})

describe('a question that takes several answers', () => {
  it('asks with checkboxes and an Other box instead of one button per choice', () => {
    expect(cardOf(prompt(multi()))).toMatchObject({ state: 'asking', why: 'Where should it go?', pick: { kind: 'many', choices: ['staging', 'production', 'canary'] } })
    expect(outline(threadView(session([prompt(multi())]), CLOCK)).split('\n').slice(1)).toEqual([
      '◆ Hermes has a question',
      '    Where should it go?',
      '    [ ] staging  [ ] production  [ ] canary  [ ] Other  [Answer] [Skip]'
    ])
  })

  it('is busy while the chat is not live', () => {
    expect(cardOf(prompt(multi()), false)).toMatchObject({ state: 'asking', busy: true })
  })

  it('reads a JSON-array answer as the labels in plain words', () => {
    expect(answered(multi(), { kind: 'text', value: '["staging","production","a preview box"]' })).toBe('You answered “staging”, “production” and “a preview box”.')
    expect(answered(multi(), { kind: 'text', value: '["canary"]' })).toBe('You answered “canary”.')
  })

  it('reads typed words as one answer, even when they are not JSON', () => {
    expect(answered(multi(), { kind: 'text', value: '[draft] a preview box' })).toBe('You answered “[draft] a preview box”.')
  })

  it('says a blank answer was a skip', () => {
    expect(answered(multi(), { kind: 'text', value: '' })).toBe('You skipped this question.')
    expect(answered(multi(), { kind: 'text', value: '[]' })).toBe('You skipped this question.')
  })

  it('leaves a single-answer question that looks like JSON as typed', () => {
    expect(answered({ ...multi(), multi: false }, { kind: 'text', value: '["a","b"]' })).toBe('You answered “["a","b"]”.')
  })
})

describe('Always allow', () => {
  it('asks a second time, naming the pattern Hermes flagged', () => {
    const card = cardOf(prompt(approval('delete in root path')))
    if (card.state !== 'asking' || card.pick.kind !== 'one') throw new Error('expected buttons')
    expect(card.pick.buttons.map(button => [button.label, button.confirm])).toEqual([
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
    const always = card.state === 'asking' && card.pick.kind === 'one' ? card.pick.buttons.find(button => button.reply.kind === 'choice' && button.reply.value === 'always') : undefined
    expect(always?.confirm?.body).toBe('Hermes won\'t ask again for commands matching “rm -rf scratch”, in this chat or any other.')
  })
})

describe('the recorded multi-select question', () => {
  const view = (state: Tracked) => outline(threadView(sessionOf(state, { state: 'online' }, null), CLOCK))
  const story = choose()
  const states: Tracked[] = []
  fold(story, ({ state }) => states.push(state))

  it('asks with a box per label Hermes sent, its Recommended mark included', () => {
    const asking = states.find(state => view(state).includes('◆ Hermes has a question'))
    expect(asking && view(asking).split('\n').slice(-3)).toEqual([
      '◆ Hermes has a question',
      '    Where should I deploy the build?',
      '    [ ] staging (Recommended)  [ ] production  [ ] canary  [ ] Other  [Answer] [Skip]'
    ])
  })

  it('settles into the labels the story checked, in plain words', () => {
    expect(view(fold(story))).toContain('○ You answered “staging (Recommended)” and “canary”.')
  })
})

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
    tuning: { reasoning: null, busy: null, effort: null, fast: null, yolo: null, approvals: null }, sides: [], processes: null, control: null, rewound: {},
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

describe('an approval Hermes waits on for a limited time', () => {
  const { now } = CLOCK
  const due = (deadline: number, state?: PromptItem['state']): PromptItem => ({ ...prompt(approval(null), state), deadline })
  const at = (item: PromptItem, clock: number) => threadView(session([item]), { ...CLOCK, now: clock })
  const shown = (item: PromptItem, clock: number) => {
    const node = at(item, clock).turns[0]?.nodes[0]
    if (node?.kind !== 'prompt') throw new Error(`expected a prompt, got ${node?.kind}`)
    return node.card
  }

  it('counts down in whole minutes, then in seconds in the last minute', () => {
    const item = due(now + 5 * 60_000)
    expect(shown(item, now)).toMatchObject({ state: 'asking', left: '5 min left' })
    expect(shown(item, now + 1)).toMatchObject({ state: 'asking', left: '5 min left' })
    expect(shown(item, now + 60_000)).toMatchObject({ state: 'asking', left: '4 min left' })
    expect(shown(item, now + 4 * 60_000)).toMatchObject({ state: 'asking', left: '60 s left' })
    expect(shown(item, now + 4 * 60_000 + 15_500)).toMatchObject({ state: 'asking', left: '45 s left' })
    expect(shown(item, now + 5 * 60_000 - 1)).toMatchObject({ state: 'asking', left: '1 s left' })
  })

  it('wakes the window each time the words change: each minute, then each second, then at the deadline', () => {
    const item = due(now + 5 * 60_000)
    expect(at(item, now + 1).changesAt).toBe(now + 60_000)
    expect(at(item, now + 3 * 60_000 + 30_000).changesAt).toBe(now + 4 * 60_000)
    expect(at(item, now + 4 * 60_000 + 15_500).changesAt).toBe(now + 4 * 60_000 + 16_000)
    expect(at(item, now + 5 * 60_000 - 1).changesAt).toBe(now + 5 * 60_000)
  })

  it('says it expired and that nothing was done once the deadline passes, and offers to ask again', () => {
    const expired = { state: 'expired', heading: 'Approval expired', command: 'rm -rf scratch', words: 'Nobody answered in time, so Hermes did not run it.', askAgain: "I didn't answer in time. Please ask me again." }
    expect(shown(due(now + 5 * 60_000), now + 5 * 60_000)).toEqual(expired)
    expect(shown(due(now - 60_000, { s: 'expired' }), now)).toEqual(expired)
    expect(outline(at(due(now), now)).split('\n').slice(1)).toEqual([
      '◇ Approval expired `rm -rf scratch`',
      '    Nobody answered in time, so Hermes did not run it.',
      '    [Ask again]',
      '◉ Thinking'
    ])
  })

  it('draws the same expired card once the turn has ended, whether or not the chat is live', () => {
    const running = shown(due(now - 60_000, { s: 'expired' }), now)
    const ended = (live: boolean): Session => ({
      ...session([], live),
      run: { state: 'idle' },
      history: [{ id: 't1' as TurnId, request: null, began: null, items: [{ kind: 'prompt', id: 'p1' as PromptId, generation: 1 as Generation, ask: approval(null), state: { s: 'expired' }, deadline: null }], outcome: { kind: 'complete' }, rows: [], tokens: null, reply: null }]
    })
    for (const live of [true, false]) expect(threadView(ended(live), CLOCK).turns[0]?.nodes[0]).toMatchObject({ kind: 'prompt', card: running })
  })

  it('keeps counting nothing down once an answer is on its way', () => {
    expect(shown(due(now - 1, { s: 'sending', reply: { kind: 'choice', value: 'once' } }), now)).toMatchObject({ state: 'asking', left: null, busy: true })
  })

  it('shows no time left when Hermes named no limit', () => {
    expect(cardOf(prompt(approval(null)))).toMatchObject({ state: 'asking', left: null })
    expect(threadView(session([prompt(approval(null))]), CLOCK).changesAt).toBeNull()
  })
})

describe('an approval answered with Always allow', () => {
  const saved = (reply: PromptReply | null) => {
    const card = cardOf(prompt(approval('delete in root path'), { s: 'answered', reply }))
    return card.state === 'answered' ? card.savesRule : null
  }

  it('says it saved a rule only when this window chose Always allow', () => {
    expect(saved({ kind: 'choice', value: 'always' })).toBe(true)
    for (const reply of [{ kind: 'choice', value: 'once' }, { kind: 'choice', value: 'session' }, { kind: 'choice', value: 'deny' }, { kind: 'deny', tell: 'Use trash.' }, null] as const) {
      expect(saved(reply), JSON.stringify(reply)).toBe(false)
    }
  })

  it('says it for no question, and not for a request Hermes withdrew', () => {
    const question = prompt({ kind: 'clarify', question: 'Where?', choices: ['always'], multi: false }, { s: 'answered', reply: { kind: 'choice', value: 'always' } })
    const card = cardOf(question)
    expect(card.state === 'answered' && card.savesRule).toBe(false)
    const withdrawn = cardOf(prompt(approval(null), { s: 'withdrawn' }))
    expect(withdrawn.state === 'answered' && withdrawn.savesRule).toBe(false)
  })

  it('adds a line to the outline that says where the rule went', () => {
    const view = threadView(session([prompt(approval(null), { s: 'answered', reply: { kind: 'choice', value: 'always' } })]), CLOCK)
    expect(outline(view).split('\n').slice(1, 3)).toEqual(['○ You allowed commands like this from now on. `rm -rf scratch`', '    Saved as an allow rule. [Open Permissions]'])
  })
})

import { describe, expect, it } from 'vitest'
import type {
  FileDiff, Generation, Item, NoticeItem, Outcome, PromptId, PromptItem, Session, SettledTurn, Sync, ToolId, ToolItem, ToolResult, TurnId
} from '../../hermes/src/domain/session'
import { checkThread, outline, threadView, type StepView, type ThreadNode, type ThreadView } from '../src/thread-view'

const CLOCK = { now: 1_800_000_000_000, timeZone: 'UTC' }
const COMPLETE: Outcome = { kind: 'complete' }
const NONE: ToolResult = { kind: 'none' }

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1' as Session['id'], title: '', cwd: null, history: [], earlier: 'none', run: { state: 'idle' }, outbox: [],
    model: { current: null, next: null, ask: null }, sync: { state: 'live' }, ...over
  }
}

const settled = (items: readonly Item<'settled'>[], outcome: Outcome = COMPLETE, id = 't1'): SettledTurn =>
  ({ id: id as TurnId, request: { text: 'Do the errand', inputId: null, rowId: null }, began: null, items, outcome, rows: [] })

const running = (items: readonly Item[], sync: Sync = { state: 'live' }, announced: string | null = null): Session => session({
  sync,
  run: { state: 'running', generation: 1 as Generation, stop: 'none', turn: { id: 't9' as TurnId, request: { text: 'Do the errand', inputId: null, rowId: null }, began: null, items, announced } }
})

const text = (markdown: string): Item<'settled'> => ({ kind: 'text', markdown, sealed: true })

function tool(name: string, args: ToolItem['args'], over: { diffs?: readonly FileDiff[]; result?: ToolResult; durationS?: number | null } = {}): ToolItem<'settled'> {
  return {
    kind: 'tool', id: `${name}-${JSON.stringify(args)}` as ToolId, name, args,
    status: { s: 'done', durationS: over.durationS ?? null, diffs: over.diffs ?? [], result: over.result ?? NONE }
  }
}
const runningTool = (name: string, args: ToolItem['args']): ToolItem => ({ kind: 'tool', id: `${name}-run` as ToolId, name, args, status: { s: 'running', note: null } })

function diff(path: string, added: number, removed: number, createsFile = false): FileDiff {
  return { path, createsFile, deletesFile: false, cut: false, added, removed, lines: [{ t: 'hunk', text: createsFile ? `@@ -0,0 +1,${added} @@` : '@@ -1 +1 @@' }] }
}

const command = (output: string, exitCode = 0): ToolResult => ({ kind: 'command', output, exitCode, clipped: 0 })

function approval<S extends 'open' | 'settled' = 'open'>(state: PromptItem<S>['state'], cmd = 'rm -rf scratch'): PromptItem<S> {
  return { kind: 'prompt', id: 'p1' as PromptId, generation: 1 as Generation, ask: { kind: 'approval', command: cmd, reason: 'delete', choices: ['once', 'deny', 'session', 'always'] }, state }
}

const turnOf = (s: Session) => threadView(s, CLOCK).turns.at(-1)!
const nodesOf = (s: Session) => turnOf(s).nodes
const stepOf = (node: ThreadNode | undefined): StepView => {
  if (node?.kind !== 'step') throw new Error(`expected a step, got ${node?.kind}`)
  return node.step
}
const lines = (s: Session, opened?: ReadonlySet<string>) => outline(threadView(s, CLOCK), opened).split('\n')

describe('end marks', () => {
  it('ends a lost turn in words and never with the done check', () => {
    const view = threadView(session({ history: [settled([text('Working on it.')], { kind: 'lost' })] }), CLOCK)
    expect(view.turns[0]!.end).toEqual({ kind: 'lost', words: 'Ended while Highwing was disconnected.' })
    expect(outline(view)).not.toContain('✓')
    expect(outline(view).split('\n').at(-1)).toBe('~ Ended while Highwing was disconnected.')
  })

  it.each([
    ['auth_permanent', "Hermes couldn't sign in to its model provider. Check the provider's key or sign-in in Hermes."],
    ['rate_limit', 'The model provider is limiting requests. Try again in a moment.'],
    ['something_new', 'HTTP 401 from provider'],
    [null, 'HTTP 401 from provider']
  ])('words a failed turn with code %s in plain language, falling back to the gateway message', (code, words) => {
    const failed: Outcome = { kind: 'failed', message: 'HTTP 401 from provider', code, retryable: false }
    expect(turnOf(session({ history: [settled([], failed)] })).end).toEqual({ kind: 'failed', words })
  })

  it('pauses an open turn when the link is not live, and disables its prompt', () => {
    const offline = running([approval({ s: 'waiting', error: null })], { state: 'offline' })
    expect(turnOf(offline).end).toEqual({ kind: 'paused', words: 'Paused while Highwing is disconnected.' })
    expect(nodesOf(offline)[0]).toMatchObject({ kind: 'prompt', card: { state: 'asking', busy: true } })
    expect(lines(offline).at(-1)).toBe('◌ Paused while Highwing is disconnected.')
  })

  it('opens a tip row while thinking or preparing a tool', () => {
    expect(lines(running([text('On it.')])).at(-1)).toBe('◉ Thinking')
    expect(lines(running([text('On it.')], { state: 'live' }, 'write_file')).at(-1)).toBe('◉ Preparing `write_file`')
  })

  it('puts the live end on a group whose last step runs, titled by that step', () => {
    const live = running([tool('write_file', { path: '/w/a.md' }, { diffs: [diff('/w/a.md', 3, 0, true)] }), runningTool('patch', { path: '/w/a.md' })])
    const [group] = nodesOf(live)
    expect(turnOf(live).end).toEqual({ kind: 'at', nodeKey: group!.key, tone: 'live', elapsed: null })
    expect(lines(live).slice(1)).toEqual(['◉ Editing `a.md` · 2 steps', '    ● Created `a.md`  +3', '    ● Editing `a.md`'])
  })
})

describe('approvals beside their tool', () => {
  const answered = approval<'settled'>({ s: 'answered', reply: { kind: 'choice', value: 'session' } })
  const rm = tool('terminal', { command: 'rm -rf scratch' }, { result: command(''), durationS: 4 })
  const ls = tool('terminal', { command: 'ls' }, { result: command('a') })

  it.each([
    ['after its tool, as the real gateway sends it', [ls, rm, answered]],
    ['before its tool, as a scripted gateway sends it', [ls, answered, rm]]
  ])('reads the same when the prompt arrives %s', (_, items) => {
    expect(lines(session({ history: [settled(items)] })).slice(1)).toEqual([
      '● Ran `ls`',
      '○ You allowed this for this chat.',
      '● Ran `rm -rf scratch`',
      '✓ Done'
    ])
  })

  it('keeps the command on an answered card with no tool beside it', () => {
    expect(lines(session({ history: [settled([text('Asked.'), answered])] }))[2]).toBe('○ You allowed this for this chat. `rm -rf scratch`')
  })

  it('holds back the tool while its approval asks', () => {
    const asking = running([ls, runningTool('terminal', { command: 'rm -rf scratch' }), approval({ s: 'waiting', error: null })])
    expect(nodesOf(asking).map(node => node.kind)).toEqual(['step', 'prompt'])
    expect(checkThread(threadView(asking, CLOCK))).toEqual([])
  })
})

describe('notices', () => {
  const declined = (method: string): NoticeItem => ({ kind: 'notice', what: 'declined', requestId: 'r1', method })

  it.each(['sudo', 'sudo.request'])('says no to a sudo request (%s) in words', method => {
    expect(nodesOf(running([declined(method)]))[0]).toMatchObject({
      kind: 'notice', tone: 'info', text: "Hermes asked for your sudo password. Highwing can't show that prompt yet, so it said no."
    })
  })

  it('names the method of a request it has no words for', () => {
    expect(nodesOf(running([declined('vault.unlock')]))[0]).toMatchObject({ text: "Hermes sent a request Highwing can't show yet (vault.unlock), so it said no." })
  })
})

describe('steps and groups', () => {
  it('shows an unknown tool as Used <name>', () => {
    expect(stepOf(nodesOf(session({ history: [settled([tool('browser_navigate', { url: 'https://example.org' })])] }))[0]).title)
      .toEqual([{ t: 'text', v: 'Used ' }, { t: 'code', v: 'browser_navigate' }])
  })

  it('drops a leading cd from a command subject', () => {
    expect(lines(session({ history: [settled([tool('terminal', { command: 'cd "/tmp/my work" && make test' })])] }))[1]).toBe('● Ran `make test`')
  })

  it('leaves the group stat null when every diff touches the same file, and sums it otherwise', () => {
    const same = [tool('write_file', { path: '/w/a.md' }, { diffs: [diff('/w/a.md', 5, 0, true)] }), tool('patch', { path: '/w/a.md' }, { diffs: [diff('/w/a.md', 1, 1)] })]
    const two = [same[0]!, tool('patch', { path: '/w/b.md' }, { diffs: [diff('/w/b.md', 2, 1)] })]
    expect(nodesOf(session({ history: [settled(same)] }))[0]).toMatchObject({ kind: 'group', stat: null })
    expect(nodesOf(session({ history: [settled(two)] }))[0]).toMatchObject({ kind: 'group', stat: { added: 7, removed: 1 } })
    expect(lines(session({ history: [settled([...two, tool('terminal', { command: 'ls' })])] }))[1])
      .toBe('■ Created `a.md`, edited `b.md` and ran `ls` · 3 steps  +7 -1')
  })

  it('reads an empty command output as No output', () => {
    const s = session({ history: [settled([tool('terminal', { command: 'true' }, { result: command('') })])] })
    const step = stepOf(nodesOf(s)[0])
    expect(step.record).toEqual({ sections: [{ kind: 'output', label: null, body: { empty: 'No output' }, copy: null }], command: 'true' })
    expect(lines(s, new Set([step.key])).slice(1, 3)).toEqual(['● Ran `true`', '      No output'])
  })

  it('labels record sections only when there are two or more', () => {
    const one = stepOf(nodesOf(session({ history: [settled([tool('terminal', { command: 'ls' }, { result: command('a') })])] }))[0])
    const two = stepOf(nodesOf(session({ history: [settled([tool('read_file', { path: '/w/a.md' }, { result: { kind: 'text', text: 'hi', isError: false, clipped: 0 } })])] }))[0])
    expect(one.record?.sections.map(section => section.label)).toEqual([null])
    expect(two.record?.sections.map(section => [section.kind, section.label])).toEqual([['result', 'Result'], ['input', 'Input']])
  })

  it('reads a history turn with no diffs plainly', () => {
    const s = session({ history: [settled([tool('write_file', { path: '/w/notes.md', content: '# Todo' })])] })
    const step = stepOf(nodesOf(s)[0])
    expect(lines(s)[1]).toBe('● Wrote `notes.md`')
    expect(step.record?.sections.map(section => section.kind)).toEqual(['input'])
  })

  it('formats a duration of one second or more', () => {
    const s = session({ history: [settled([tool('terminal', { command: 'make' }, { durationS: 0.4 }), text('Then.'), tool('terminal', { command: 'make' }, { durationS: 75 })])] })
    expect(lines(s).slice(1, 4)).toEqual(['● Ran `make`', '| Then.', '● Ran `make`  1 min 15 s'])
  })

  it('trims blank lines around prose', () => {
    expect(nodesOf(running([text('\n\nEdited.\n\n')]))[0]).toMatchObject({ kind: 'prose', markdown: 'Edited.' })
  })
})

describe('memoisation', () => {
  it('keeps every settled TurnView when only the open turn changes', () => {
    const history = [settled([text('First.')], COMPLETE, 't1'), settled([text('Second.')], COMPLETE, 't2')]
    const before = threadView({ ...running([text('Thinking about it')]), history }, CLOCK)
    const after = threadView({ ...running([text('Thinking about it, and more')]), history }, CLOCK)
    expect(after.turns[0]).toBe(before.turns[0])
    expect(after.turns[1]).toBe(before.turns[1])
    expect(after.turns[2]).not.toBe(before.turns[2])
  })
})

describe('checkThread', () => {
  it('reports each broken invariant', () => {
    const step: StepView = { key: 't1/0', title: [], state: 'done', stat: null, duration: null, record: null }
    const view: ThreadView = {
      state: 'ready', pending: [], earlier: 'none', changesAt: null,
      turns: [
        {
          key: 't1', time: null, request: null, rowId: null, end: { kind: 'at', nodeKey: 't1/7', tone: 'live', elapsed: null },
          nodes: [{ kind: 'group', key: 't1/g0', title: [], count: 1, stat: null, steps: [step] }, { kind: 'prose', key: 't1/0', markdown: 'x', streaming: true }]
        },
        { key: 't2', time: null, request: null, rowId: null, end: { kind: 'done', words: 'Done' }, nodes: [] }
      ]
    }
    expect(checkThread(view)).toEqual([
      'turn t1: group t1/g0 has 1 step',
      'key t1/0 is used twice',
      'turn t1: only the last turn may be unsettled, this one ends at',
      'turn t1: the end sits on t1/7, which is not a node'
    ])
  })
})

describe('what a change copies', () => {
  const copyOf = (lines: FileDiff['lines'], over: Partial<Pick<FileDiff, 'cut' | 'deletesFile'>> = {}) => {
    const diff: FileDiff = { path: '/w/a.md', createsFile: false, deletesFile: false, cut: false, added: 0, removed: 2, lines, ...over }
    const s = session({ history: [settled([tool('patch', { path: '/w/a.md' }, { diffs: [diff] })])] })
    const [section] = stepOf(nodesOf(s)[0]).record?.sections ?? []
    return section?.copy
  }

  it('copies a file emptied by its only hunk as an edit, never as a delete', () => {
    expect(copyOf([{ t: 'hunk', text: '@@ -1,2 +0,0 @@' }, { t: 'del', text: 'one' }, { t: 'del', text: 'two' }]))
      .toBe('--- a//w/a.md\n+++ b//w/a.md\n@@ -1,2 +0,0 @@\n-one\n-two\n')
  })

  it('copies a file Hermes deleted with /dev/null as its target', () => {
    expect(copyOf([{ t: 'hunk', text: '@@ -1,2 +0,0 @@' }, { t: 'del', text: 'one' }, { t: 'del', text: 'two' }], { deletesFile: true }))
      .toBe('--- a//w/a.md\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-one\n-two\n')
  })

  it('copies nothing when Hermes cut the diff short', () => {
    expect(copyOf([{ t: 'hunk', text: '@@ -1,2 +0,0 @@' }, { t: 'del', text: 'one' }, { t: 'del', text: 'two' }], { cut: true })).toBeNull()
  })

  it('copies the whole command a step ran, where the title clips it', () => {
    const ran = `cd /w && ${'echo long '.repeat(12)}`
    const step = stepOf(nodesOf(session({ history: [settled([tool('terminal', { command: ran }, { result: command('ok') })])] }))[0])
    expect(step.title.at(-1)?.v).not.toBe(ran)
    expect(step.record?.command).toBe(ran)
  })

  it('offers no command for a tool that is not a command', () => {
    const step = stepOf(nodesOf(session({ history: [settled([tool('read_file', { path: '/w/a.md' }, { result: { kind: 'text', text: 'hi', isError: false, clipped: 0 } })])] }))[0])
    expect(step.record?.command).toBeNull()
  })
})

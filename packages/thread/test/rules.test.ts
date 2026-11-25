import { describe, expect, it } from 'vitest'
import type {
  AdmissionId, FileDiff, Generation, HelperId, HelperItem, HermesRequest, InputId, Item, NoticeItem, Outcome, PlanEntry, PlanItem, PromptId, PromptItem, QueuedMessage, ReasoningItem,
  RequestId, Session, SettledTurn, Sync, ToolId, ToolItem, ToolResult, TurnId
} from '../../hermes/src/domain/session'
import { checkThread, findInThread, outline, threadView, type HelperView, type PlanView, type StepView, type ThreadNode, type ThreadView } from '../src/thread-view'

const CLOCK = { now: 1_800_000_000_000, timeZone: 'UTC' }
const COMPLETE: Outcome = { kind: 'complete' }
const NONE: ToolResult = { kind: 'none' }

function session(over: Partial<Session> = {}): Session {
  return {
    id: 's1' as Session['id'], title: '', cwd: null, history: [], earlier: 'none', run: { state: 'idle' }, interlude: [], requests: [], queue: [], outbox: [],
    model: { current: null, next: null, ask: null }, usage: { totals: null, context: null }, tuning: { reasoning: null, busy: null, effort: null, fast: null, yolo: null }, sides: [], processes: null, control: null, sync: { state: 'live' }, ...over
  }
}

const settled = (items: readonly Item<'settled'>[], outcome: Outcome = COMPLETE, id = 't1'): SettledTurn =>
  ({ id: id as TurnId, request: { text: 'Do the errand', inputId: null, rowId: null, attachments: [] }, began: null, items, outcome, rows: [], tokens: null, reply: null })

const running = (items: readonly Item[], sync: Sync = { state: 'live' }, announced: string | null = null): Session => session({
  sync,
  run: { state: 'running', generation: 1 as Generation, stop: 'none', turn: { id: 't9' as TurnId, request: { text: 'Do the errand', inputId: null, rowId: null, attachments: [] }, began: null, items, announced } }
})

const text = (markdown: string): Item<'settled'> => ({ kind: 'text', markdown, sealed: true })

function tool(name: string, args: ToolItem['args'], over: { diffs?: readonly FileDiff[]; result?: ToolResult; durationS?: number | null; image?: string | null } = {}): ToolItem<'settled'> {
  return {
    kind: 'tool', id: `${name}-${JSON.stringify(args)}` as ToolId, name, args,
    status: { s: 'done', durationS: over.durationS ?? null, diffs: over.diffs ?? [], result: over.result ?? NONE, image: over.image ?? null }
  }
}
const runningTool = (name: string, args: ToolItem['args']): ToolItem => ({ kind: 'tool', id: `${name}-run` as ToolId, name, args, status: { s: 'running', note: null } })

function diff(path: string, added: number, removed: number, createsFile = false): FileDiff {
  return { path, createsFile, deletesFile: false, cut: false, added, removed, lines: [{ t: 'hunk', text: createsFile ? `@@ -0,0 +1,${added} @@` : '@@ -1 +1 @@' }] }
}

const command = (output: string, exitCode = 0): ToolResult => ({ kind: 'command', output, exitCode, clipped: 0 })

function approval<S extends 'open' | 'settled' = 'open'>(state: PromptItem<S>['state'], cmd = 'rm -rf scratch'): PromptItem<S> {
  return { kind: 'prompt', id: 'p1' as PromptId, generation: 1 as Generation, ask: { kind: 'approval', command: cmd, reason: 'delete', choices: ['once', 'deny', 'session', 'always'] }, state, deadline: null }
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

describe('what a reply used', () => {
  const used = (tokens: SettledTurn['tokens']) => threadView(session({ history: [{ ...settled([text('Done.')]), tokens }] }), CLOCK).turns[0]?.tokens

  it('says the counts in and out, grouped by thousands', () => {
    expect(used({ input: 1204, output: 380, reasoning: 0 })).toBe('1,204 in, 380 out')
  })

  it('adds the reasoning count only when the model reasoned', () => {
    expect(used({ input: 1204, output: 380, reasoning: 412 })).toBe('1,204 in, 380 out, 412 reasoning')
  })

  it('says nothing for a turn Hermes named no counts for, and nothing while a turn runs', () => {
    expect(used(null)).toBeNull()
    expect(threadView(running([text('Working')]), CLOCK).turns[0]?.tokens).toBeNull()
  })

  it('prints the counts under the turn\'s end in the outline', () => {
    const view = threadView(session({ history: [{ ...settled([text('Done.')]), tokens: { input: 12, output: 3, reasoning: 0 } }] }), CLOCK)
    expect(outline(view).split('\n').slice(-2)).toEqual(['✓ Done', '  12 in, 3 out'])
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

  it('says no to a setup step in words', () => {
    expect(nodesOf(running([declined('setup_beat')]))[0]).toMatchObject({
      kind: 'notice', tone: 'info', text: "Hermes asked to show a setup step. Highwing can't show that yet, so it said no."
    })
  })

  it('names the method of a request it has no words for', () => {
    expect(nodesOf(running([declined('preview.read')]))[0]).toMatchObject({ text: "Hermes sent a request Highwing can't show yet (preview.read), so it said no." })
  })

  it('carries where a request closed as a node of its own, with a line in the outline', () => {
    const closed: NoticeItem = { kind: 'notice', what: 'closed', requestId: 'srq-1' as RequestId, asked: 'sudo', end: 'answered' }
    const view = threadView(running([closed]), CLOCK)
    expect(view.turns[0]?.nodes).toEqual([{ kind: 'closed', key: expect.any(String), asked: 'sudo', end: 'answered', words: 'You sent a password.' }])
    expect(outline(view).split('\n')).toContain('○ You sent a password.')
    expect(checkThread(view)).toEqual([])
  })

  it('keeps the live end on the running tool while Hermes waits on a request', () => {
    const sudo: HermesRequest = { id: 'srq-1' as RequestId, ask: { kind: 'secret', for: { is: 'sudo', command: 'sudo true' } }, state: { s: 'waiting', error: null }, deadline: null }
    const waiting = { ...running([runningTool('terminal', { command: 'sudo true' })]), requests: [sudo] }
    expect(threadView(waiting, CLOCK).turns[0]?.end).toMatchObject({ kind: 'at', tone: 'live' })
    expect(checkThread(threadView(waiting, CLOCK))).toEqual([])
  })
})

describe('steps and groups', () => {
  it('shows an unknown tool as Used <name>', () => {
    expect(stepOf(nodesOf(session({ history: [settled([tool('browser_navigate', { url: 'https://example.org' })])] }))[0]).title)
      .toEqual([{ t: 'text', v: 'Used ' }, { t: 'code', v: 'browser_navigate' }])
  })

  it('carries a done step\'s image path, with no record needed', () => {
    const step = stepOf(nodesOf(session({ history: [settled([tool('screenshot', {}, { image: '/tmp/shot.png' })])] }))[0])
    expect(step).toMatchObject({ image: '/tmp/shot.png', record: null })
    expect(stepOf(nodesOf(running([runningTool('screenshot', {})]))[0]).image).toBeNull()
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
    const step: StepView = { key: 't1/0', title: [], state: 'done', stat: null, duration: null, record: null, image: null }
    const view: ThreadView = {
      state: 'ready', pending: [], asks: [], earlier: 'none', changesAt: null,
      turns: [
        {
          key: 't1', time: null, request: null, attachments: [], rowId: null, end: { kind: 'at', nodeKey: 't1/7', tone: 'live', elapsed: null }, tokens: '9 in, 1 out',
          nodes: [{ kind: 'group', key: 't1/g0', title: [], count: 1, stat: null, steps: [step] }, { kind: 'prose', key: 't1/0', markdown: 'x', streaming: true }]
        },
        { key: 't2', time: null, request: null, attachments: [], rowId: null, end: { kind: 'done', words: 'Done' }, nodes: [], tokens: null }
      ]
    }
    expect(checkThread(view)).toEqual([
      'turn t1: shows token counts before it ended',
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

const thought = (text: string, over: Partial<ReasoningItem> = {}): ReasoningItem => ({ kind: 'reasoning', text, sealed: true, startedAt: null, endedAt: null, ...over })
const sealedThought = (text: string, over: Partial<ReasoningItem<'settled'>> = {}): ReasoningItem<'settled'> =>
  ({ kind: 'reasoning', text, sealed: true, startedAt: null, endedAt: null, ...over })

function helper(id: string, state: HelperItem['state'], over: Partial<HelperItem> = {}): HelperItem {
  return { kind: 'helper', id: id as HelperId, parentId: null, depth: 0, goal: `Check ${id}`, state, toolCount: null, steps: [], ...over }
}
const WORKING: HelperItem['state'] = { s: 'working', doing: null }
const ended = (status: 'completed' | 'failed' | 'timeout' | 'interrupted', durationS: number | null = 3.27, summary: string | null = null): HelperItem['state'] =>
  ({ s: 'ended', status, durationS, summary })
const ranTool = (name: string, preview: string | null) => ({ kind: 'tool', name, preview }) as const
const child = (id: string) => ({ kind: 'helper', id: id as HelperId }) as const

const entry = (id: string, status: PlanEntry['status'], parentId: string | null = null): PlanEntry => ({ id, text: `do ${id}`, status, parentId })
const plan = (...entries: PlanEntry[]): PlanItem => ({ kind: 'plan', revision: 1, entries })

const helperOf = (node: ThreadNode | undefined): HelperView => {
  if (node?.kind !== 'helper') throw new Error(`expected a helper, got ${node?.kind}`)
  return node.helper
}
const planOf = (node: ThreadNode | undefined): PlanView => {
  if (node?.kind !== 'plan') throw new Error(`expected a plan, got ${node?.kind}`)
  return node.plan
}
const delegating = runningTool('delegate_task', { tasks: [] })
const delegated = tool('delegate_task', { tasks: [] })

describe('what another node already shows', () => {
  it('hides delegate_task once the turn holds the helper it started, and merges the tools around it', () => {
    const before = [tool('read_file', { path: '/w/a' }), delegated, tool('read_file', { path: '/w/b' })]
    expect(lines(session({ history: [settled(before)] }))[1]).toBe('■ Used 3 tools · 3 steps')
    expect(lines(running([...before, helper('sa-1', WORKING)])).slice(1, 3)).toEqual(['■ Used 2 tools · 2 steps', '    ● Read `a`'])
    expect(nodesOf(running([...before, helper('sa-1', WORKING)])).map(node => node.kind)).toEqual(['group', 'helper'])
  })

  it.each(['todo', 'todo_list'])('hides the %s tool once the turn holds a plan, and keeps it while there is none', name => {
    const todo = tool(name, { todos: [] })
    expect(nodesOf(running([todo])).map(node => node.kind)).toEqual(['step'])
    expect(nodesOf(running([tool('terminal', { command: 'ls' }), todo, plan(entry('1', 'pending')), tool('terminal', { command: 'pwd' })])).map(node => node.kind))
      .toEqual(['step', 'plan', 'step'])
  })

  it('draws a helper of a helper inside its parent, counting the helpers below it', () => {
    const items = [
      helper('sa-1', WORKING, { steps: [ranTool('terminal', 'ls'), child('sa-2')] }),
      helper('sa-2', WORKING, { parentId: 'sa-1' as HelperId, depth: 1, steps: [child('sa-3')] }),
      helper('sa-3', ended('completed'), { parentId: 'sa-2' as HelperId, depth: 2 })
    ]
    const nodes = nodesOf(running(items))
    expect(nodes.map(node => node.kind)).toEqual(['helper'])
    expect(helperOf(nodes[0]).steps.at(-1)).toEqual({ kind: 'helper', key: 't9/0/h1', goal: 'Check sa-2', state: 'working', more: 1 })
  })

  it('shows a helper whose parent is not in the turn as a node of its own', () => {
    expect(nodesOf(running([helper('sa-2', WORKING, { parentId: 'sa-1' as HelperId, depth: 1 })])).map(node => node.kind)).toEqual(['helper'])
  })

  it('hides blank reasoning and keeps a reasoning block between tools as its own node', () => {
    const items = [tool('read_file', { path: '/w/a' }), thought(' \n'), tool('read_file', { path: '/w/b' }), thought('Next, b.'), tool('read_file', { path: '/w/c' })]
    expect(nodesOf(running(items)).map(node => node.kind)).toEqual(['group', 'reasoning', 'step'])
  })
})

describe('reasoning', () => {
  it.each([
    [400, 'under a second'], [999, 'under a second'], [1_000, '1.0 s'], [4_200, '4.2 s'], [12_300, '12 s'], [65_000, '1 min 5 s']
  ])('says a block of %i ms took %s', (ms, words) => {
    expect(nodesOf(running([thought('Hmm', { startedAt: 1_000, endedAt: 1_000 + ms })]))[0]).toMatchObject({ kind: 'reasoning', duration: words })
  })

  it('has no duration while it streams or when this client did not see it start', () => {
    expect(nodesOf(running([thought('Hmm', { sealed: false, startedAt: 1_000 })]))[0]).toMatchObject({ streaming: true, duration: null })
    expect(nodesOf(running([thought('Hmm', { startedAt: null, endedAt: 5_000 })]))[0]).toMatchObject({ streaming: false, duration: null })
  })

  it('trims blank lines around the text', () => {
    expect(nodesOf(running([thought('\n\nFirst.\n\nSecond.\n\n')]))[0]).toMatchObject({ text: 'First.\n\nSecond.' })
  })

  it('outlines a block as Thought, live and streaming while it streams, with its lines when opened', () => {
    const streaming = running([thought('One.\nTwo.', { sealed: false })])
    expect(lines(streaming).slice(1)).toEqual(['◉ Thought …'])
    expect(turnOf(streaming).end).toMatchObject({ kind: 'at', nodeKey: 't9/0', tone: 'live' })
    const settledBlock = session({ history: [settled([sealedThought('One.\nTwo.', { startedAt: 0, endedAt: 12_000 })])] })
    expect(lines(settledBlock).slice(1)).toEqual(['▸ Thought', '✓ Done'])
    expect(lines(settledBlock, new Set(['t1/0'])).slice(1, 4)).toEqual(['▸ Thought', '    One.', '    Two.'])
  })

  it('falls back to the Thinking tip while the streaming block is still blank', () => {
    expect(lines(running([thought('\n', { sealed: false })])).slice(1)).toEqual(['◉ Thinking'])
  })
})

describe('helpers', () => {
  const nodeOf = (item: HelperItem, settledTurn = false) =>
    helperOf(nodesOf(settledTurn ? session({ history: [settled([item])] }) : running([item]))[0])

  it.each<[HelperItem['state'], string | null]>([
    [{ s: 'queued' }, 'Waiting to start'],
    [{ s: 'working', doing: 'thinking' }, 'Thinking'],
    [{ s: 'working', doing: null }, null],
    [ended('completed'), null]
  ])('says what a %o helper does now', (state, now) => {
    expect(nodeOf(helper('sa-1', state)).now).toEqual(now === null ? null : [{ t: 'text', v: now }])
  })

  it('says nothing now while an approval card asks for the command the helper started', () => {
    const using = helper('sa-1', { s: 'working', doing: 'tool' }, { steps: [ranTool('terminal', 'rm old.tar.gz')] })
    const ask = approval({ s: 'waiting', error: null }, 'rm old.tar.gz')
    expect(helperOf(nodesOf(running([using, ask]))[0]).now).toBeNull()
    expect(helperOf(nodesOf(running([using, approval({ s: 'answered', reply: null }, 'rm old.tar.gz')]))[0]).now)
      .toEqual([{ t: 'text', v: 'Started ' }, { t: 'code', v: 'rm old.tar.gz' }])
  })

  it('says which tool a working helper started last, skipping delegate_task', () => {
    const using = helper('sa-1', { s: 'working', doing: 'tool' }, { steps: [ranTool('read_file', 'a.txt'), ranTool('terminal', 'du -sh'), ranTool('delegate_task', null)] })
    const view = nodeOf(using)
    expect(view.now).toEqual([{ t: 'text', v: 'Started ' }, { t: 'code', v: 'du -sh' }])
    expect(view.steps).toEqual([
      { kind: 'step', key: 't9/0/s0', title: [{ t: 'text', v: 'Read ' }, { t: 'code', v: 'a.txt' }], latest: false },
      { kind: 'step', key: 't9/0/s1', title: [{ t: 'text', v: 'Started ' }, { t: 'code', v: 'du -sh' }], latest: true }
    ])
    expect(view.count).toBe(3)
  })

  it('titles each tool of an ended helper with its done verb, and a tool it has no words for as Used', () => {
    const done = nodeOf(helper('sa-1', ended('completed'), { toolCount: 5, steps: [ranTool('terminal', 'du -sh'), ranTool('browser_navigate', 'example.org')] }))
    expect(done.steps.map(step => step.kind === 'step' && [step.title, step.latest])).toEqual([
      [[{ t: 'text', v: 'Ran ' }, { t: 'code', v: 'du -sh' }], false],
      [[{ t: 'text', v: 'Used ' }, { t: 'code', v: 'browser_navigate' }], false]
    ])
    expect(done.count).toBe(5)
  })

  it.each<[HelperItem['state'], string, string | null]>([
    [ended('completed'), 'done', null], [ended('failed'), 'failed', 'Failed'], [ended('timeout'), 'failed', 'Timed out'],
    [ended('interrupted'), 'failed', 'Stopped'], [{ s: 'queued' }, 'queued', null], [WORKING, 'working', null]
  ])('reads a %o helper as %s with the words %s', (state, shown, words) => {
    expect(nodeOf(helper('sa-1', state))).toMatchObject({ state: shown, ended: words })
  })

  it('keeps the first line of the goal, clipped at 120 characters', () => {
    expect(nodeOf(helper('sa-1', WORKING, { goal: 'Short goal\nwith detail' })).goal).toBe('Short goal')
    const long = nodeOf(helper('sa-1', WORKING, { goal: 'x'.repeat(200) })).goal
    expect(long).toHaveLength(120)
    expect(long.endsWith('…')).toBe(true)
  })

  it('gives a duration of a second or more and the summary only once it ended', () => {
    expect(nodeOf(helper('sa-1', ended('completed', 3.27, '\n\nAll good.\n'), { toolCount: 1 }))).toMatchObject({ duration: '3.3 s', summary: 'All good.' })
    expect(nodeOf(helper('sa-1', ended('completed', 0.4, '  \n')))).toMatchObject({ duration: null, summary: null })
  })

  it('outlines a closed helper with its now line, and an open one with its steps and summary', () => {
    const items = [
      helper('sa-1', ended('failed', 75, 'Disk is fine.\nMore.'), { toolCount: 2, steps: [ranTool('terminal', 'du -sh'), child('sa-2')] }),
      helper('sa-2', { s: 'queued' }, { parentId: 'sa-1' as HelperId, depth: 1, steps: [child('sa-3'), child('sa-4')] }),
      helper('sa-3', WORKING, { parentId: 'sa-2' as HelperId, depth: 2 }),
      helper('sa-4', WORKING, { parentId: 'sa-2' as HelperId, depth: 2 }),
      helper('sa-5', { s: 'working', doing: 'thinking' }, { toolCount: 1 })
    ]
    const s = session({ history: [settled(items)] })
    expect(lines(s).slice(1)).toEqual([
      '◆ Helper Check sa-1 · 2 steps  (Failed)  1 min 15 s',
      '◇ Helper Check sa-5 · 1 step',
      '    Thinking',
      '✓ Done'
    ])
    expect(lines(s, new Set(['t1/0'])).slice(1, 5)).toEqual([
      '◆ Helper Check sa-1 · 2 steps  (Failed)  1 min 15 s',
      '    ● Ran `du -sh`',
      '    ◇ Helper Check sa-2  and 2 helpers of its own',
      "    Helper's summary: Disk is fine."
    ])
  })

  it('puts the live end on the newest helper the agent started while it waits on it', () => {
    const live = running([helper('sa-1', ended('completed')), helper('sa-2', WORKING), helper('sa-3', { s: 'queued' }, { parentId: 'sa-2' as HelperId })])
    expect(turnOf(live).end).toEqual({ kind: 'at', nodeKey: 't9/1', tone: 'live', elapsed: null })
    expect(lines(live).slice(1)).toEqual(['◆ Helper Check sa-1 · 0 steps  3.3 s', '◉ Helper Check sa-2 · 0 steps'])
  })

  it('leaves a helper working in a settled turn without a live end', () => {
    const view = threadView(session({ history: [settled([helper('sa-1', WORKING)])] }), CLOCK)
    expect(view.turns[0]?.end).toEqual({ kind: 'done', words: 'Done' })
    expect(checkThread(view)).toEqual([])
  })
})

describe('plans', () => {
  it('orders entries as Hermes sent them, each followed by its children, and counts done of what is not cancelled', () => {
    const view = planOf(nodesOf(running([plan(entry('b', 'completed', 'a'), entry('a', 'in_progress'), entry('c', 'cancelled'), entry('d', 'pending', 'gone'))]))[0])
    expect(view).toEqual({
      done: 1, total: 3, cancelled: 1, openByDefault: true,
      entries: [
        { key: 't9/0/ea', text: 'do a', state: 'doing', depth: 0 },
        { key: 't9/0/eb', text: 'do b', state: 'done', depth: 1 },
        { key: 't9/0/ec', text: 'do c', state: 'cancelled', depth: 0 },
        { key: 't9/0/ed', text: 'do d', state: 'todo', depth: 0 }
      ]
    })
  })

  it('places entries whose parents form a cycle once each', () => {
    const view = planOf(nodesOf(running([plan(entry('a', 'pending', 'b'), entry('b', 'pending', 'a'), entry('c', 'pending', 'c'))]))[0])
    expect(view.entries.map(({ text, depth }) => [text, depth])).toEqual([['do a', 0], ['do b', 1], ['do c', 0]])
  })

  it('opens by default only while its turn runs', () => {
    expect(planOf(nodesOf(session({ history: [settled([plan(entry('1', 'pending'))])] }))[0]).openByDefault).toBe(false)
  })

  it('outlines the plan with a checked box once all is done, and its entries indented by depth when opened', () => {
    const open = session({ history: [settled([plan(entry('a', 'completed'), entry('b', 'in_progress', 'a'), entry('c', 'cancelled'), entry('d', 'pending'))])] })
    expect(lines(open, new Set(['t1/0'])).slice(1, 6)).toEqual([
      '☐ Plan · 1 of 3 done, 1 cancelled',
      '    [x] do a',
      '      [>] do b',
      '    [-] do c',
      '    [ ] do d'
    ])
    expect(lines(session({ history: [settled([plan(entry('a', 'completed'), entry('b', 'cancelled'))])] }))[1]).toBe('☑ Plan · 1 of 1 done, 1 cancelled')
    expect(lines(session({ history: [settled([plan()])] }))[1]).toBe('☐ Plan · 0 of 0 done')
  })
})

describe('the live end while a hidden tool runs', () => {
  it('sits on the helper delegate_task started', () => {
    const live = running([helper('sa-1', ended('completed')), delegating, helper('sa-2', { s: 'queued' })])
    expect(turnOf(live).end).toMatchObject({ kind: 'at', nodeKey: 't9/2', tone: 'live' })
    expect(lines(live).slice(1)).toEqual(['◆ Helper Check sa-1 · 0 steps  3.3 s', '◉ Helper Check sa-2 · 0 steps', '    Waiting to start'])
  })

  it('sits on the plan while the to-do tool runs', () => {
    const live = running([plan(entry('1', 'pending')), runningTool('todo_list', { todos: [] })])
    expect(turnOf(live).end).toMatchObject({ kind: 'at', nodeKey: 't9/0', tone: 'live' })
    expect(lines(live)[1]).toBe('◉ Plan · 0 of 1 done')
  })

  it('opens the Thinking tip when no helper is waiting', () => {
    const live = running([helper('sa-1', ended('completed')), delegating])
    expect(turnOf(live).end).toEqual({ kind: 'tip', words: [{ t: 'text', v: 'Thinking' }], elapsed: null })
  })
})

describe('checkThread on helpers, plans and reasoning', () => {
  const turn = (nodes: ThreadNode[], end: ThreadView['turns'][number]['end']): ThreadView => ({
    state: 'ready', pending: [], asks: [], earlier: 'none', changesAt: null, turns: [{ key: 't1', time: null, request: null, attachments: [], rowId: null, tokens: null, nodes, end }]
  })
  const planNode = (key: string): ThreadNode => ({ kind: 'plan', key, plan: { done: 0, total: 1, cancelled: 0, openByDefault: true, entries: [{ key: `${key}/e1`, text: 'x', state: 'todo', depth: 0 }] } })
  const reasoningNode = (key: string, streaming: boolean): ThreadNode => ({ kind: 'reasoning', key, text: 'x', streaming, duration: null })
  const helperNode = (key: string, state: HelperView['state']): ThreadNode => ({
    kind: 'helper', key, helper: { goal: 'x', state, ended: null, now: null, count: 0, duration: null, steps: [{ kind: 'step', key: `${key}/s0`, title: [], latest: false }], summary: null }
  })
  const live = (nodeKey: string) => ({ kind: 'at', nodeKey, tone: 'live', elapsed: null }) as const

  it('reports two plan nodes in one turn', () => {
    expect(checkThread(turn([planNode('t1/0'), planNode('t1/1')], live('t1/1')))).toEqual(['turn t1: 2 plan nodes'])
  })

  it('reports two streaming reasoning blocks, and reasoning that streams in a settled turn', () => {
    expect(checkThread(turn([reasoningNode('t1/0', true), reasoningNode('t1/1', true)], live('t1/1')))).toEqual(['turn t1: 2 reasoning nodes are streaming'])
    expect(checkThread(turn([reasoningNode('t1/0', true)], { kind: 'done', words: 'Done' }))).toEqual(['turn t1: ends done while reasoning streams'])
  })

  it('lets the live end sit on a streaming block, a helper at work or a plan, and nowhere else of theirs', () => {
    expect(checkThread(turn([reasoningNode('t1/0', true)], live('t1/0')))).toEqual([])
    expect(checkThread(turn([helperNode('t1/0', 'queued')], live('t1/0')))).toEqual([])
    expect(checkThread(turn([planNode('t1/0')], live('t1/0')))).toEqual([])
    expect(checkThread(turn([reasoningNode('t1/0', false)], live('t1/0')))).toEqual(['turn t1: the live end sits on reasoning t1/0'])
    expect(checkThread(turn([helperNode('t1/0', 'done')], live('t1/0')))).toEqual(['turn t1: the live end sits on helper t1/0'])
  })

  it('claims the keys of helper steps and plan entries', () => {
    expect(checkThread(turn([helperNode('t1/0', 'working'), { kind: 'prose', key: 't1/0/s0', markdown: 'x', streaming: false }], live('t1/0'))))
      .toEqual(['key t1/0/s0 is used twice'])
    expect(checkThread(turn([planNode('t1/0'), { kind: 'notice', key: 't1/0/e1', tone: 'info', text: 'x', detail: null }], live('t1/0'))))
      .toEqual(['key t1/0/e1 is used twice'])
  })
})

describe('attachments', () => {
  const sent = [
    { id: 'a-1' as never, name: 'error.png', kind: 'image' as const, size: 2048 },
    { id: 'a-2' as never, name: 'contract.pdf', kind: 'file' as const, size: 4096 }
  ]

  it('draws what was sent with a request above it, in the order sent', () => {
    const turn = { ...settled([text('It is a null pointer.')]), request: { text: 'What does this error mean?', inputId: null, rowId: 1, attachments: sent } }
    const view = threadView(session({ history: [turn] }), CLOCK)
    expect(view.turns[0]?.attachments).toEqual(sent)
    expect(outline(view)).toBe(['+ [image] error.png  [file] contract.pdf', '> What does this error mean?', '| It is a null pointer.', '✓ Done'].join('\n'))
  })

  it('draws them with a message still on its way', () => {
    const view = threadView(session({ outbox: [{ inputId: 'i1' as never, text: 'Summarise this', attachments: [sent[1]!], state: { s: 'sending' } }] }), CLOCK)
    expect(view.pending[0]?.attachments).toEqual([sent[1]])
    expect(outline(view)).toBe(['+ [file] contract.pdf', '⋯ Summarise this  (sending)'].join('\n'))
  })

  it('draws them with a message Hermes holds in its queue', () => {
    const queued: QueuedMessage = { admissionId: 'a1' as AdmissionId, inputId: 'i1' as InputId, text: 'Summarise this', from: 'here', attachments: sent, state: { s: 'queued', can: [] } }
    const view = threadView(session({ queue: [queued] }), CLOCK)
    expect(view.pending[0]?.attachments).toEqual(sent)
    expect(outline(view)).toBe(['+ [image] error.png  [file] contract.pdf', '⋯ Summarise this  (queued, cancel)'].join('\n'))
  })
})

describe('what Hermes says', () => {
  const goal: Item<'settled'> = { kind: 'status', what: 'line', about: 'goal', text: 'Goal met.\nAll three items are done.' }
  const notice = (state: 'shown' | 'cleared'): Item<'settled'> =>
    ({ kind: 'status', what: 'notice', key: 'credits', level: 'warn', text: 'Credits are low.', detail: null, ttlMs: null, seenAt: null, state })
  const moa: Item<'settled'> = { kind: 'moa', progress: { done: 2, total: 3 }, references: [{ label: 'a', text: 'Use rm.' }], phase: { is: 'aggregating', by: 'judge' } }
  const interlude = (items: readonly Item<'settled'>[], id = 'interlude:2'): SettledTurn =>
    ({ id: id as TurnId, request: null, began: null, items, outcome: { kind: 'interlude' }, rows: [], tokens: null, reply: null })

  const timed = (seenAt: number | null, ttlMs: number | null, over: Partial<Extract<Item, { kind: 'status'; what: 'notice' }>> = {}): Item<'settled'> =>
    ({ kind: 'status', what: 'notice', key: 'sync', level: 'info', text: 'Synced.', detail: null, ttlMs, seenAt, state: 'shown', ...over })
  const at = (now: number) => ({ ...CLOCK, now })

  it('prints a glyph line for a MoA round and a status line, and leaves out a cleared notice', () => {
    const turn = running([moa, goal, notice('shown'), notice('cleared')])
    expect(lines(turn)).toEqual([
      '> Do the errand',
      '≋ Asking 3 models · Combining their answers',
      '· goal: Goal met.',
      '! warn: Credits are low.',
      '◉ Thinking'
    ])
    expect(checkThread(threadView(turn, CLOCK))).toEqual([])
  })

  it('says how many models a MoA round asks and how many answered, and opens to each answer', () => {
    const round = (progress: { done: number; total: number } | null, phase: Extract<Item, { kind: 'moa' }>['phase'] = { is: 'advising' }): Item<'settled'> =>
      ({ kind: 'moa', progress, references: [], phase })
    expect(lines(running([round(null)]))[1]).toBe('≋ Asking models')
    expect(lines(running([round({ done: 0, total: 1 })]))[1]).toBe('≋ Asking 1 model · 0 answered')
    expect(lines(running([round({ done: 2, total: 3 })]))[1]).toBe('≋ Asking 3 models · 2 answered')
    expect(lines(running([round({ done: 3, total: 3 }, { is: 'aggregating', by: null })]))[1]).toBe('≋ Asking 3 models · Combining their answers')
    expect(lines(running([moa]), new Set(['t9/0'])).slice(1, 3)).toEqual(['≋ Asking 3 models · Combining their answers', '    a: Use rm.'])
  })

  it('gives a notice the tone of its level, and its detail behind a press', () => {
    const levels = (['info', 'success', 'warn', 'error'] as const).map(level => timed(null, null, { level, text: level }))
    expect(lines(running(levels)).slice(1, 5)).toEqual(['! info', '! success', '! warn: warn', '! error: error'])
    const detailed = running([timed(null, null, { detail: 'The full story.\nSecond line.' })])
    expect(lines(detailed).slice(1, 2)).toEqual(['! Synced.'])
    expect(lines(detailed, new Set(['t9/0'])).slice(1, 4)).toEqual(['! Synced.', '    The full story.', '    Second line.'])
  })

  it('finds the words of a notice\'s detail and of each MoA answer, and opens their node to show them', () => {
    const view = threadView(running([timed(null, null, { detail: 'Prune the cache?' }), moa, goal]), CLOCK)
    expect(findInThread(view, 'cache').map(match => match.opens)).toEqual([['t9/0']])
    expect(findInThread(view, 'Use rm').map(match => match.opens)).toEqual([['t9/1']])
    expect(findInThread(view, 'Combining').map(match => match.opens)).toEqual([[]])
    expect(findInThread(view, 'Goal met').map(match => match.opens)).toEqual([[]])
  })

  it('shows a notice until its time to live runs out, and says when the view changes for it', () => {
    const shown = CLOCK.now - 1_000
    const idle = session({ history: [settled([text('Done.'), timed(shown, 5_000)])] })
    const before = threadView(idle, CLOCK)
    expect(outline(before).split('\n')).toEqual(['> Do the errand', '| Done.', '! Synced.', '✓ Done'])
    expect(before.changesAt).toBe(shown + 5_000)
    const after = threadView(idle, at(shown + 5_000))
    expect(outline(after).split('\n')).toEqual(['> Do the errand', '| Done.', '✓ Done'])
    expect(after.changesAt).toBeNull()
  })

  it('takes the earliest notice to run out, in the open turn and the interlude alike, and none that has run out', () => {
    const now = CLOCK.now
    expect(threadView(session({ interlude: [timed(now - 10, 100), timed(now, 50, { key: 'b' })] }), CLOCK).changesAt).toBe(now + 50)
    expect(threadView(running([timed(now - 10, 100)]), CLOCK).changesAt).toBe(now + 90)
    expect(threadView(running([timed(now - 200, 100), timed(null, null, { key: 'b' })]), CLOCK).changesAt).toBeNull()
  })

  it('drops an interlude once nothing in it shows, and keeps one that still says something', () => {
    const history = [settled([text('Done.')]), interlude([notice('cleared')]), settled([text('Again.')], COMPLETE, 't3')]
    expect(threadView(session({ history }), CLOCK).turns.map(turn => turn.key)).toEqual(['t1', 't3'])
    expect(threadView(session({ history: [settled([text('Done.')])], interlude: [notice('cleared')] }), CLOCK).turns.map(turn => turn.key)).toEqual(['t1'])
    expect(threadView(session({ interlude: [timed(CLOCK.now, 10)] }), at(CLOCK.now + 10)).turns).toEqual([])
    expect(threadView(session({ interlude: [notice('cleared'), goal] }), CLOCK).turns.map(turn => turn.nodes.map(node => node.kind))).toEqual([['status']])
  })

  it('shows the live interlude after the last turn, with no request and no end mark', () => {
    const view = threadView(session({ history: [settled([text('Done.')])], interlude: [goal] }), CLOCK)
    expect(view.turns.map(turn => [turn.key, turn.end.kind])).toEqual([['t1', 'done'], ['interlude:live', 'none']])
    expect(outline(view).split('\n')).toEqual(['> Do the errand', '| Done.', '✓ Done', '', '· goal: Goal met.'])
    expect(checkThread(view)).toEqual([])
  })

  it('draws a sealed interlude between turns as settled, with no end mark', () => {
    const view = threadView(session({ history: [settled([text('Done.')]), interlude([goal]), settled([text('Again.')], COMPLETE, 't3')] }), CLOCK)
    expect(view.turns.map(turn => turn.end.kind)).toEqual(['done', 'none', 'done'])
    expect(checkThread(view)).toEqual([])
  })

  it('shows every row of Hermes\'s queue under the last turn with its sender and what it offers, ahead of what Hermes has not listed', () => {
    const row = (id: string, from: 'here' | 'elsewhere', state: QueuedMessage['state']): QueuedMessage =>
      ({ admissionId: `a-${id}` as AdmissionId, inputId: id as InputId, text: `message ${id}`, from, attachments: [], state })
    const view = threadView(session({
      queue: [
        row('lost', 'elsewhere', { s: 'lost', generation: 1 as Generation }),
        row('one', 'here', { s: 'queued', can: ['edit', 'sendNow'] }),
        row('two', 'elsewhere', { s: 'queued', can: [] }),
        row('three', 'here', { s: 'steering' })
      ],
      outbox: [
        { inputId: 'four' as InputId, text: 'message four', attachments: [], state: { s: 'sending' } },
        { inputId: 'five' as InputId, text: 'message five', attachments: [], state: { s: 'failed', message: 'Hermes refused it.' } }
      ]
    }), CLOCK)
    expect(view.pending).toEqual([
      { status: 'lost', key: 'lost', text: 'message lost', attachments: [], admissionId: 'a-lost', from: 'elsewhere', actions: ['release'] },
      { status: 'queued', key: 'one', text: 'message one', attachments: [], admissionId: 'a-one', from: 'here', actions: ['sendNow', 'edit', 'cancel'] },
      { status: 'queued', key: 'two', text: 'message two', attachments: [], admissionId: 'a-two', from: 'elsewhere', actions: ['cancel'] },
      { status: 'steering', key: 'three', text: 'message three', attachments: [], admissionId: 'a-three', from: 'here', actions: [] },
      { status: 'sending', key: 'four', text: 'message four', attachments: [] },
      { status: 'failed', key: 'five', text: 'message five', attachments: [], detail: 'Hermes refused it.' }
    ])
    expect(outline(view).split('\n').slice(-6)).toEqual([
      '⋯ message lost  (lost, from elsewhere, release)',
      '⋯ message one  (queued, sendNow, edit, cancel)',
      '⋯ message two  (queued, from elsewhere, cancel)',
      '⋯ message three  (steering)',
      '⋯ message four  (sending)',
      '⋯ message five  (failed: Hermes refused it.)'
    ])
    expect(checkThread(view)).toEqual([])
  })

  it('draws words steered into a turn where they sit in it', () => {
    const view = threadView(session({ history: [settled([tool('terminal', { command: 'ls' }), { kind: 'steer', text: 'use trash-put instead\nplease' }, text('Done.')])] }), CLOCK)
    expect(view.turns[0]?.nodes.map(node => node.kind)).toEqual(['step', 'steer', 'prose'])
    expect(outline(view)).toContain('» use trash-put instead')
    expect(checkThread(view)).toEqual([])
  })

  it('offers to tell Hermes what to do instead only on an approval that can be denied', () => {
    const asking = (choices: readonly string[]) => {
      const card = nodesOf(running([{ ...approval({ s: 'waiting', error: null }), ask: { kind: 'approval', command: 'rm -rf x', reason: null, choices } }]))[0]
      return card?.kind === 'prompt' && card.card.state === 'asking' ? card.card.tell : null
    }
    expect(asking(['once', 'deny'])).toBe(true)
    expect(asking(['once', 'session'])).toBe(false)
    const clarify = nodesOf(running([{ ...approval({ s: 'waiting', error: null }), ask: { kind: 'clarify', question: 'Which?', choices: ['a', 'deny'], multi: false } }]))[0]
    expect(clarify).toMatchObject({ kind: 'prompt', card: { state: 'asking', tell: false } })
  })

  it('words a denial that told Hermes what to do as a denial', () => {
    const denied: PromptItem<'settled'> = {
      kind: 'prompt', id: 'p1' as PromptId, generation: 1 as Generation, ask: { kind: 'approval', command: 'rm -rf x', reason: null, choices: ['once', 'deny'] },
      state: { s: 'answered', reply: { kind: 'deny', tell: 'use trash-put instead' } }, deadline: null
    }
    const plain: PromptItem<'settled'> = { ...denied, id: 'p2' as PromptId, state: { s: 'answered', reply: { kind: 'choice', value: 'deny' } } }
    const cards = threadView(session({ history: [settled([denied, plain])] }), CLOCK).turns[0]?.nodes.flatMap(node => (node.kind === 'prompt' ? [node.card] : []))
    expect(cards).toHaveLength(2)
    expect(cards?.[0]).toEqual(cards?.[1])
  })
})

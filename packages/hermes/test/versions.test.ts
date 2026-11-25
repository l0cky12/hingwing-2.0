import { describe, expect, it } from 'vitest'
import type { SessionId } from '../src/domain/session'
import { branchPoint, familiesOf, label, versionsOf, type BranchPoint, type ChatVersions, type Said } from '../src/domain/versions'
import { RpcRefusal, type Calls } from '../src/wire/link'
import type { ProjectsTreeResult, StoredTranscriptResult } from '../src/wire/contract.generated'
import { parseSaid, parseTreeRows } from '../src/wire/parse'
import { readVersions } from '../src/versions'

const id = (name: string) => name as SessionId
const [PARENT, SECOND, THIRD, GRANDCHILD, CONTINUED] = ['parent', 'second', 'third', 'grandchild', 'continued'].map(id) as [SessionId, SessionId, SessionId, SessionId, SessionId]

const branch = (name: string, from: string, startedAt: number) => ({ id: name, parent_session_id: from, _branched_from: from, started_at: startedAt })
const TREE: ProjectsTreeResult = {
  projects: [{
    id: 'home', label: 'Home',
    previewSessions: [
      branch('third', 'parent', 30),
      { id: 'parent', parent_session_id: null, _branched_from: null, started_at: 10 },
      { id: 'continued', parent_session_id: 'parent', continuation_kind: 'compression', started_at: 25 }
    ],
    repos: [{ id: 'repo', label: 'repo', groups: [{ id: 'main', label: 'main', sessions: [branch('second', 'parent', 20), branch('grandchild', 'second', 40), branch('third', 'parent', 30)] }] }]
  }]
}

const said = (rows: readonly (readonly [role: string, text: string])[]): StoredTranscriptResult => ({
  session_id: 's', next_cursor: 'c', reset: false,
  rows: rows.map(([role, text], at) => ({ role, text, row_id: at + 1, timestamp: 1000 + at, row_kind: 'message' }))
})
const read = (rows: readonly (readonly [string, string])[]): readonly Said[] => parseSaid(said(rows))?.said ?? []

const SHARED = [['user', 'Sort the invoices'], ['assistant', 'Sorted them.']] as const
const TRANSCRIPTS: Readonly<Record<string, readonly (readonly [string, string])[]>> = {
  parent: [...SHARED, ['user', 'Group by customer'], ['assistant', 'Grouped by customer.'], ['user', 'Who owes most?'], ['assistant', 'Acme.']],
  second: [...SHARED, ['user', 'Group by month'], ['assistant', 'Grouped by month.']],
  third: [...SHARED, ['user', 'Group by amount'], ['assistant', 'Grouped by amount.']],
  grandchild: [...SHARED, ['user', 'Group by month'], ['assistant', 'Grouped by month.'], ['user', 'And by week'], ['assistant', 'Done.']]
}

const pointsFor = (pairs: readonly (readonly [parent: string, child: string])[]) =>
  new Map<SessionId, BranchPoint | null>(pairs.map(([parent, child]) => [id(child), branchPoint(read(TRANSCRIPTS[parent] ?? []), read(TRANSCRIPTS[child] ?? []))]))
const labels = (versions: ChatVersions) => versions.map(group => [label(group), group.versions.map(version => [version.sessionId, version.landing])])

describe('the chats that are versions of one message', () => {
  const rows = parseTreeRows(TREE) ?? []

  it('two chats branched from one chat group with it, oldest first, and that chat reads 1 / 3', () => {
    const family = familiesOf(rows, PARENT)
    expect(family).toEqual({ above: null, below: [SECOND, THIRD] })
    const versions = versionsOf(PARENT, family, pointsFor([['parent', 'second'], ['parent', 'third']]))
    expect(labels(versions)).toEqual([['1 / 3', [[PARENT, 3], [SECOND, 3], [THIRD, 3]]]])
  })

  it('a chat branched from a branch does not join the first chat, and groups with its own parent', () => {
    expect(familiesOf(rows, PARENT).below).not.toContain(GRANDCHILD)
    const family = familiesOf(rows, SECOND)
    expect(family).toEqual({ above: { parent: PARENT, children: [SECOND, THIRD] }, below: [GRANDCHILD] })
    const versions = versionsOf(SECOND, family, pointsFor([['parent', 'second'], ['parent', 'third'], ['second', 'grandchild']]))
    expect(labels(versions), 'the grandchild stops where the branch does, so its try sits after its last turn').toEqual([
      ['2 / 3', [[PARENT, 3], [SECOND, 3], [THIRD, 3]]],
      ['1 / 2', [[SECOND, 'end'], [GRANDCHILD, 5]]]
    ])
    expect(familiesOf(rows, GRANDCHILD)).toEqual({ above: { parent: SECOND, children: [GRANDCHILD] }, below: [] })
  })

  it('a compression continuation is not counted, though it names the chat as its parent', () => {
    expect(rows.find(row => row.id === CONTINUED)).toEqual({ id: CONTINUED, parent: null, startedAt: 25 })
    expect(familiesOf(rows, CONTINUED)).toEqual({ above: null, below: [] })
    expect(familiesOf(rows, PARENT).below).not.toContain(CONTINUED)
  })

  it('a chat listed in two places counts once, and an archived branch is left out', () => {
    expect(rows.filter(row => row.id === THIRD)).toHaveLength(1)
    const archived = parseTreeRows({ projects: [{ id: 'home', label: 'Home', previewSessions: [{ ...branch('second', 'parent', 20), archived: true }] }] })
    expect(archived).toEqual([])
  })

  it('a branch that says the same as its parent so far is no version yet', () => {
    const family = { above: null, below: [SECOND, THIRD] }
    expect(versionsOf(PARENT, family, new Map<SessionId, BranchPoint | null>([[SECOND, null], [THIRD, { turn: 1, a: 3, b: 3 }]])))
      .toEqual([{ versions: [{ sessionId: PARENT, landing: 3 }, { sessionId: THIRD, landing: 3 }], current: 0 }])
    expect(versionsOf(PARENT, family, new Map<SessionId, BranchPoint | null>([[SECOND, null], [THIRD, null]]))).toEqual([])
  })

  it('a version that cannot be placed is left out, and a message the asked chat cannot be placed at has no group', () => {
    const above = { parent: PARENT, children: [SECOND, THIRD] }
    const unplaced = new Map<SessionId, BranchPoint | null>([[SECOND, { turn: 1, a: 3, b: 3 }], [THIRD, { turn: 1, a: 3, b: null }]])
    expect(versionsOf(SECOND, { above, below: [] }, unplaced)).toEqual([{ versions: [{ sessionId: PARENT, landing: 3 }, { sessionId: SECOND, landing: 3 }], current: 1 }])
    expect(versionsOf(THIRD, { above, below: [] }, unplaced)).toEqual([])
  })

  it('a tree Highwing cannot read is refused whole', () => {
    expect(parseTreeRows({ projects: [{ id: 'home', label: 'Home', previewSessions: [{ title: 'no id' }] }] } as unknown as ProjectsTreeResult)).toBeNull()
    expect(parseTreeRows({ projects: 'none' } as unknown as ProjectsTreeResult)).toBeNull()
  })
})

describe('the message two chats part at', () => {
  it('is the third message when the transcripts differ there, in both chats', () => {
    const a = read([['user', 'u1'], ['assistant', 'a1'], ['user', 'u2'], ['assistant', 'a2']])
    const b = read([['user', 'u1'], ['assistant', 'a1'], ['user', 'u2 again'], ['assistant', 'a2 again']])
    expect(branchPoint(a, b)).toEqual({ turn: 1, a: 3, b: 3 })
  })

  it('is the same message when only its reply differs', () => {
    const a = read([['user', 'u1'], ['assistant', 'a1'], ['user', 'u2'], ['assistant', 'a2']])
    const b = read([['user', 'u1'], ['assistant', 'a1'], ['user', 'u2'], ['assistant', 'another a2']])
    expect(branchPoint(a, b)).toEqual({ turn: 1, a: 3, b: 3 })
  })

  it('is the end of the chat that stops first', () => {
    const a = read([['user', 'u1'], ['assistant', 'a1'], ['user', 'u2'], ['assistant', 'a2']])
    expect(branchPoint(a, a.slice(0, 2))).toEqual({ turn: 1, a: 3, b: 'end' })
  })

  it('is nowhere when the chats say the same, whatever their row ids and times', () => {
    const a = read([['user', 'u1'], ['assistant', 'a1']])
    const renumbered = parseSaid({ session_id: 's', next_cursor: 'c', reset: false, rows: [{ role: 'user', text: 'u1', row_id: 41, timestamp: 9, row_kind: 'message' }, { role: 'assistant', text: 'a1', row_id: 42, timestamp: 9, row_kind: 'message' }] })
    expect(branchPoint(a, renumbered?.said ?? [])).toBeNull()
  })

  it('cannot be placed in a chat whose turn there has no stored request', () => {
    const a = read([['assistant', 'a note before any request'], ['user', 'u1']])
    const b = read([['assistant', 'another note'], ['user', 'u1']])
    expect(branchPoint(a, b)).toEqual({ turn: 0, a: null, b: null })
  })
})

describe('reading the versions of a chat from Hermes', () => {
  function hermes(answers: { readonly tree: () => ProjectsTreeResult; readonly pageRows?: number }) {
    const calls: { readonly method: string; readonly params: Record<string, unknown> }[] = []
    const via: Calls = {
      link: { state: 'online' },
      call: (async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params })
        if (method === 'projects.tree') return answers.tree()
        const rows = TRANSCRIPTS[String(params.session_id)] ?? []
        const from = Number(params.cursor ?? 0)
        const page = rows.slice(from, from + (answers.pageRows ?? 500))
        return { ...said(page), rows: said(rows).rows.slice(from, from + page.length), next_cursor: String(from + page.length) }
      }) as Calls['call']
    }
    return { via, calls, read: () => calls.filter(call => call.method === 'session.transcript').map(call => call.params.session_id) }
  }

  it('a refused tree is a refusal, and no chat is read', async () => {
    const { via, read } = hermes({ tree: () => { throw new RpcRefusal(-32601, 'unknown_method', 'unknown method: projects.tree') } })
    expect(await readVersions(via, PARENT)).toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes doesn't support that." } })
    expect(read()).toEqual([])
  })

  it('a chat with no family is answered from the tree alone', async () => {
    const { via, calls } = hermes({ tree: () => TREE })
    expect(await readVersions(via, CONTINUED)).toEqual({ ok: true, value: [] })
    expect(calls.map(call => call.method)).toEqual(['projects.tree'])
  })

  it('a family is read page by page, each chat once, and placed at the message its chats part at', async () => {
    const { via, read } = hermes({ tree: () => TREE, pageRows: 4 })
    const versions = await readVersions(via, SECOND)
    expect(versions.ok && labels(versions.value)).toEqual([
      ['2 / 3', [[PARENT, 3], [SECOND, 3], [THIRD, 3]]],
      ['1 / 2', [[SECOND, 'end'], [GRANDCHILD, 5]]]
    ])
    const firstPages = read().filter((sessionId, at, all) => all.indexOf(sessionId) === at)
    expect(firstPages.toSorted()).toEqual([GRANDCHILD, PARENT, SECOND, THIRD].toSorted())
    expect(read().filter(sessionId => sessionId === PARENT), 'six rows in pages of four: two pages and the empty one that ends the read').toHaveLength(3)
  })

  it('a chat that never ends is given up on, and nothing is guessed', async () => {
    const calls: string[] = []
    const endless: Calls = {
      link: { state: 'online' },
      call: (async (method: string) => {
        calls.push(method)
        return method === 'projects.tree' ? TREE : said([['user', 'again']])
      }) as Calls['call']
    }
    expect(await readVersions(endless, PARENT)).toMatchObject({ ok: false, refusal: { kind: 'unsupported' } })
    expect(calls.filter(method => method === 'session.transcript').length).toBeLessThanOrEqual(3 * 20)
  })
})

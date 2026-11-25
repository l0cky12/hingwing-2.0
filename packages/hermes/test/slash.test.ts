import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Outcome } from '../src/domain/command'
import type { SessionId } from '../src/domain/session'
import { ownCommand, slashLineOf, type RunOwn, type SlashCatalog } from '../src/domain/slash'
import { loadFixture } from '../src/testing/fixture'
import type { CommandsCatalogResult } from '../src/wire/contract.generated'
import { parseCatalog, parseDirective } from '../src/wire/parse'

const SLASH = loadFixture(fileURLToPath(new URL('../../../fixtures/slash.jsonl', import.meta.url)))
const CATALOG = SLASH.header.catalog as CommandsCatalogResult

const RUNS = [
  'new', 'title', 'compress', 'rollback', 'bg', 'btw', 'goal', 'heartbeat', 'refine', 'review', 'loop', 'plan', 'moa', 'subgoal', 'status', 'egress', 'context',
  'whoami', 'profile', 'codex-runtime', 'personality', 'diff', 'yolo', 'approvals', 'reasoning', 'fast', 'busy', 'autoprune', 'skills',
  'memory', 'bundles', 'learn', 'init', 'suggestions', 'blueprint', 'help', 'usage', 'topup', 'version', 'debug'
]

describe('parseCatalog', () => {
  const listed = parseCatalog(CATALOG)

  it('lists the commands the gateway runs, then the skills, from a real Hermes catalog', () => {
    expect(listed.filter(entry => entry.kind === 'command').map(entry => entry.name)).toEqual(RUNS)
    expect(listed.filter(entry => entry.kind === 'skill').map(entry => entry.name)).toEqual(['code-review', 'release-notes'])
    expect(listed.findIndex(entry => entry.kind === 'skill')).toBe(RUNS.length)
  })

  it('offers the settings Highwing runs itself, which Hermes marks for its terminal', () => {
    expect(CATALOG.commands?.['/busy']).toMatchObject({ desktop: 'terminal' })
    expect(CATALOG.commands?.['/fast']).toMatchObject({ desktop: 'advanced' })
    expect(listed.map(entry => entry.name)).toEqual(expect.arrayContaining(['busy', 'fast']))
  })

  it('leaves out commands the gateway refuses, terminal and hidden commands, and terminal display rows', () => {
    const names = listed.map(entry => entry.name)
    for (const name of ['compact', 'retry', 'undo', 'resume', 'stop', 'model', 'copy', 'quit', 'density', 'logs']) {
      expect(names).not.toContain(name)
    }
  })

  it('keeps the catalog description, usage hint included', () => {
    expect(listed.find(entry => entry.name === 'title')?.description).toMatch(/^Set a title for the current session/)
    expect(listed.find(entry => entry.name === 'release-notes')).toEqual({ kind: 'skill', name: 'release-notes', description: 'Draft release notes from the change log' })
  })

  it('lists a plugin command the desktop may offer, and nothing from a malformed catalog', () => {
    const plugin = parseCatalog({
      pairs: [['/deploy', 'Deploy the site'], ['/compress', 'x'], ['bad'], [7, 'x'], ['/with space', 'x']],
      commands: { '/deploy': { argument_mode: null, desktop: null } },
      plugin_commands: { deploy: 'Deploy the site' }
    } as unknown as CommandsCatalogResult)
    expect(plugin).toEqual([{ kind: 'command', name: 'deploy', description: 'Deploy the site' }])
    expect(parseCatalog({ pairs: 'nope' } as unknown as CommandsCatalogResult)).toEqual([])
    expect(parseCatalog({})).toEqual([])
  })
})

describe('OWN_COMMANDS', () => {
  const own = (text: string) => ownCommand(slashLineOf(text, parseCatalog(CATALOG))!, 's1' as SessionId)

  it.each([
    ['/title Notes cleanup', { do: 'rename', sessionId: 's1', title: 'Notes cleanup' }],
    ['/btw   which file was it? ', { do: 'side', sessionId: 's1', kind: 'btw', text: 'which file was it?' }],
    ['/BG tidy the notes', { do: 'side', sessionId: 's1', kind: 'background', text: 'tidy the notes' }],
    ['/compress', { do: 'compress', sessionId: 's1', focus: null }],
    ['/compress the release plan', { do: 'compress', sessionId: 's1', focus: 'the release plan' }],
    ['/compress here-and-now', { do: 'compress', sessionId: 's1', focus: 'here-and-now' }],
    ['/compress --keep', { do: 'compress', sessionId: 's1', focus: '--keep' }],
    ['/compress up to heresy', { do: 'compress', sessionId: 's1', focus: 'heresy' }]
  ])('turns %s into its command', (text, command) => {
    expect(own(text)).toEqual(command)
  })

  const NOTHING: Readonly<Record<string, unknown>> = {
    checkpoints: { kept: 'off' }, checkpointDiff: { stat: '', patch: '' }, restore: { files: null, kept: [], lastTurn: 'kept' }
  }
  const answered = async (text: string, ...replies: Outcome<unknown>[]) => {
    const line = own(text)
    if (line === null || !('answer' in line)) throw new Error(`${text} has no answer`)
    const ran: unknown[] = []
    const run = (async (command: { readonly do: string }) => {
      ran.push(command)
      return replies.shift() ?? { ok: true, value: NOTHING[command.do] }
    }) as RunOwn
    return { ran, shown: await line.answer(run) }
  }
  const shows = (value: unknown): Outcome<unknown> => ({ ok: true, value })

  it.each([
    ['/busy steer', { set: 'busy', to: 'steer' }, 'busy input mode: steer'],
    ['/busy QUEUE', { set: 'busy', to: 'queue' }, 'busy input mode: queue'],
    ['/busy interrupt', { set: 'busy', to: 'interrupt' }, 'busy input mode: interrupt'],
    ['/fast on', { set: 'fast', on: true }, 'fast mode: fast'],
    ['/fast Fast', { set: 'fast', on: true }, 'fast mode: fast'],
    ['/fast off', { set: 'fast', on: false }, 'fast mode: normal'],
    ['/fast normal', { set: 'fast', on: false }, 'fast mode: normal'],
    ['/reasoning high', { set: 'effort', to: 'high' }, 'reasoning: high'],
    ['/reasoning none', { set: 'effort', to: 'none' }, 'reasoning: none'],
    ['/reasoning Ultra --session', { set: 'effort', to: 'ultra' }, 'reasoning: ultra'],
    ['/reasoning reset', { set: 'effort', to: 'default' }, 'Session reasoning override cleared; falling back to global config.'],
    ['/reasoning show', { set: 'reasoning', on: true }, 'reasoning: show'],
    ['/reasoning on', { set: 'reasoning', on: true }, 'reasoning: show'],
    ['/reasoning hide', { set: 'reasoning', on: false }, 'reasoning: hide'],
    ['/reasoning off', { set: 'reasoning', on: false }, 'reasoning: hide']
  ])('sets %s for this chat with tune, and says so', async (text, set, says) => {
    expect(await answered(text)).toEqual({ ran: [{ do: 'tune', sessionId: 's1', ...set }], shown: shows(says) })
  })

  it('shows the refusal of a switch in place of its line', async () => {
    const refusal = { ok: false, refusal: { kind: 'rejected', message: "This chat's model has no fast mode." } } as const
    expect((await answered('/fast on', refusal)).shown).toEqual(refusal)
  })

  it.each([
    '/busy', '/busy status', '/busy later',
    '/fast', '/fast status', '/fast auto', '/fast cold', '/fast ultrafast', '/fast ultra', '/fast toggle', '/fast on --global',
    '/reasoning', '/reasoning high --global', '/reasoning --global show', '/reasoning reset --global', '/reasoning full', '/reasoning clamp',
    '/reasoning disabled', '/reasoning hgih', '/reasoning high low'
  ])('leaves the setting %s to Hermes', text => {
    expect(own(text)).toBeNull()
  })

  it.each([
    ['/rollback', { do: 'checkpoints', sessionId: 's1' }],
    ['/rollback list', { do: 'checkpoints', sessionId: 's1' }],
    ['/rollback LS', { do: 'checkpoints', sessionId: 's1' }],
    ['/rollback diff 2', { do: 'checkpointDiff', sessionId: 's1', checkpoint: '2' }],
    ['/rollback Diff 4f1c2a9e', { do: 'checkpointDiff', sessionId: 's1', checkpoint: '4f1c2a9e' }],
    ['/rollback 2', { do: 'restore', sessionId: 's1', checkpoint: '2', scope: { kind: 'folder', edits: 'keep' } }],
    ['/rollback 2 --all', { do: 'restore', sessionId: 's1', checkpoint: '2', scope: { kind: 'folder', edits: 'overwrite' } }],
    ['/rollback --FORCE 4f1c2a9e', { do: 'restore', sessionId: 's1', checkpoint: '4f1c2a9e', scope: { kind: 'folder', edits: 'overwrite' } }],
    ['/rollback 2 docs/release notes.md', { do: 'restore', sessionId: 's1', checkpoint: '2', scope: { kind: 'file', path: 'docs/release notes.md' } }],
    ['/rollback 2 notes.md --all', { do: 'restore', sessionId: 's1', checkpoint: '2', scope: { kind: 'file', path: 'notes.md' } }]
  ])('runs %s as one checkpoint command, a number or hash as typed', async (text, command) => {
    expect((await answered(text)).ran).toEqual([command])
  })

  it.each([
    ['/rollback list --all', '/rollback [list] | diff <n|hash> | <n|hash> [file] [--all]'],
    ['/rollback ls 2', '/rollback [list] | diff <n|hash> | <n|hash> [file] [--all]'],
    ['/rollback diff', '/rollback diff <n|hash>'],
    ['/rollback diff 1 2', '/rollback diff <n|hash>'],
    ['/rollback diff 1 --all', '/rollback diff <n|hash>']
  ])('says how to type %s', (text, usage) => {
    expect(own(text)).toEqual({ usage })
  })

  it('lists the checkpoints newest first, with the way to restore or preview one', async () => {
    const items = [
      { id: '4f1c2a9e0b7d', at: '2026-11-24T10:05:00+00:00', reason: 'before write_file notes.md' },
      { id: '9a8b7c6d5e4f', at: null, reason: '' }
    ]
    expect((await answered('/rollback', shows({ kept: 'on', items }))).shown).toEqual(shows([
      'Checkpoints (newest first):',
      '1. 4f1c2a9e  2026-11-24T10:05:00+00:00  before write_file notes.md',
      '2. 9a8b7c6d',
      '',
      'Restore with /rollback <n> [file] (add --all to also overwrite your own edits); preview with /rollback diff <n>.'
    ].join('\n')))
  })

  it.each([
    [{ kept: 'off' }, 'Checkpoints are not enabled for this session (set checkpoints.enabled in config.yaml).'],
    [{ kept: 'on', items: [] }, 'No checkpoints yet for this working directory.']
  ])('says when there is nothing to list', async (checkpoints, says) => {
    expect((await answered('/rollback', shows(checkpoints))).shown).toEqual(shows(says))
  })

  it.each([
    [{ stat: ' notes.md | 2 +-\n 1 file changed\n', patch: '--- a/notes.md\n+++ b/notes.md\n' }, ' notes.md | 2 +-\n 1 file changed\n\n--- a/notes.md\n+++ b/notes.md\n'],
    [{ stat: '', patch: '' }, 'No changes since that checkpoint.']
  ])('shows a diff as git prints it', async (diff, says) => {
    expect((await answered('/rollback diff 1', shows(diff))).shown).toEqual(shows(says))
  })

  it('says what a whole-folder restore put back, the edits it kept, and the turn it took back', async () => {
    const kept = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', 'f.md', 'g.md']
    const { shown } = await answered('/rollback 2', shows({ files: ['notes.md'], kept, lastTurn: 'removed' }))
    expect(shown).toEqual(shows([
      'Restored checkpoint 2.',
      'Kept your hand-edits: a.md, b.md, c.md, d.md, e.md (+2 more)',
      'Use /rollback <N> --all to restore those too.',
      'Chat turn undone to match restored file state.'
    ].join('\n')))
  })

  it('says which file a restore put back', async () => {
    const { shown } = await answered('/rollback 4f1c2a9e notes.md', shows({ files: null, kept: [], lastTurn: 'kept' }))
    expect(shown).toEqual(shows('Restored notes.md from checkpoint 4f1c2a9e.'))
  })

  it('shows a refused restore as the refusal', async () => {
    const refusal = { ok: false, refusal: { kind: 'stale', message: 'Wait for the reply to finish, then try again.' } } as const
    expect((await answered('/rollback 2', refusal)).shown).toEqual(refusal)
  })

  it.each([['/btw', '/btw <question>'], ['/bg', '/bg <prompt>']])('says how to type %s with nothing after it', (text, usage) => {
    expect(own(text)).toEqual({ usage })
  })

  it.each([
    '/title', '/goal ship it',
    '/compress here 3', '/compress HERE 3', '/compress up to here 3', '/compress Up To Here',
    '/compress --keep 3', '/compress -K 3', '/compress --keep=3',
    '/compress --preview', '/compress the release plan --PREVIEW', '/compress --dry-run', '/compress plan --dryrun', '/compress the plan --aggressive'
  ])('leaves %s to Hermes', text => {
    expect(own(text)).toBeNull()
  })
})

describe('parseDirective', () => {
  it('shows exec output without terminal colour codes', () => {
    expect(parseDirective({ type: 'exec', output: '\u001b[1mModel\u001b[0m: x\n' }, '/status')).toEqual({ do: 'show', text: 'Model: x' })
  })

  it('submits a skill with its display text shown and its message for the model', () => {
    expect(parseDirective({ type: 'skill', message: 'EXPANDED BODY', display: '/release-notes v2', name: 'release-notes' }, '/release-notes v2'))
      .toEqual({ do: 'submit', text: '/release-notes v2', apiText: 'EXPANDED BODY', note: null })
    expect(parseDirective({ type: 'send', message: 'Plan this', notice: 'Planning mode' }, '/plan x'))
      .toEqual({ do: 'submit', text: '/plan x', apiText: 'Plan this', note: 'Planning mode' })
  })

  it('carries out nothing it cannot honour', () => {
    expect(parseDirective({ type: 'skill', message: '  ' }, '/x')).toBeNull()
    expect(parseDirective({ type: 'alias', target: '/status' }, '/st')).toBeNull()
    expect(parseDirective({ type: 'prefill', message: 'x' }, '/x')).toBeNull()
  })
})

describe('slashLineOf', () => {
  const catalog: SlashCatalog = [
    { kind: 'command', name: 'status', description: '' },
    { kind: 'skill', name: 'release-notes', description: '' }
  ]

  it('reads a listed name and its argument', () => {
    expect(slashLineOf('/status', catalog)).toEqual({ entry: catalog[0], arg: '' })
    expect(slashLineOf('  /release-notes  since v2\nand more ', catalog)).toEqual({ entry: catalog[1], arg: 'since v2\nand more' })
  })

  it('leaves other text, unlisted names and a slash mid-sentence alone', () => {
    expect(slashLineOf('/compress', catalog)).toBeNull()
    expect(slashLineOf('see /status', catalog)).toBeNull()
    expect(slashLineOf('/', catalog)).toBeNull()
    expect(slashLineOf('/status', [])).toBeNull()
  })
})

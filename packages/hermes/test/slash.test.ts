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
  'new', 'title', 'compress', 'bg', 'btw', 'goal', 'heartbeat', 'refine', 'review', 'loop', 'plan', 'moa', 'subgoal', 'status', 'egress', 'context',
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

  /** Runs the line's answer, each command answered in turn by `replies`, and says what it ran and showed. */
  const answered = async (text: string, ...replies: Outcome<unknown>[]) => {
    const line = own(text)
    if (line === null || !('answer' in line)) throw new Error(`${text} has no answer`)
    const ran: unknown[] = []
    const run = (async (command: unknown) => {
      ran.push(command)
      return replies.shift() ?? { ok: true, value: undefined }
    }) as RunOwn
    return { ran, shown: await line.answer(run) }
  }
  const shows = (value: string) => ({ ok: true, value })

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

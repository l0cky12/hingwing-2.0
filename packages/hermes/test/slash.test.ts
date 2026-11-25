import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { SessionId } from '../src/domain/session'
import { ownCommand, slashLineOf, type SlashCatalog } from '../src/domain/slash'
import { loadFixture } from '../src/testing/fixture'
import type { CommandsCatalogResult } from '../src/wire/contract.generated'
import { parseCatalog, parseDirective } from '../src/wire/parse'

const SLASH = loadFixture(fileURLToPath(new URL('../../../fixtures/slash.jsonl', import.meta.url)))
const CATALOG = SLASH.header.catalog as CommandsCatalogResult

const RUNS = [
  'new', 'title', 'compress', 'bg', 'btw', 'goal', 'heartbeat', 'refine', 'review', 'loop', 'plan', 'moa', 'subgoal', 'status', 'egress', 'context',
  'whoami', 'profile', 'codex-runtime', 'personality', 'diff', 'yolo', 'approvals', 'reasoning', 'autoprune', 'skills',
  'memory', 'bundles', 'learn', 'init', 'suggestions', 'blueprint', 'help', 'usage', 'topup', 'version', 'debug'
]

describe('parseCatalog', () => {
  const listed = parseCatalog(CATALOG)

  it('lists the commands the gateway runs, then the skills, from a real Hermes catalog', () => {
    expect(listed.filter(entry => entry.kind === 'command').map(entry => entry.name)).toEqual(RUNS)
    expect(listed.filter(entry => entry.kind === 'skill').map(entry => entry.name)).toEqual(['code-review', 'release-notes'])
    expect(listed.findIndex(entry => entry.kind === 'skill')).toBe(RUNS.length)
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
    ['/compress the release plan', { do: 'compress', sessionId: 's1', focus: 'the release plan' }]
  ])('turns %s into its command', (text, command) => {
    expect(own(text)).toEqual(command)
  })

  it.each([['/btw', '/btw <question>'], ['/bg', '/bg <prompt>']])('says how to type %s with nothing after it', (text, usage) => {
    expect(own(text)).toEqual({ usage })
  })

  it.each(['/title', '/compress here 3', '/compress --preview', '/compress the release plan --preview', '/goal ship it'])('leaves %s to Hermes', text => {
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

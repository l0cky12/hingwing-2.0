import type { CommandOutcome, CommandRules } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { addPlan, FIRST_RULES, nextRules, removalWords, rulesSectionOf, rulesWatch, type RulesState } from '../src/renderer/setup/permissions-view'
import type { RowId } from '../src/renderer/setup/settings-view'

vi.mock('../src/renderer/store', () => ({ Epoch: {}, run: async () => ({ ok: true, value: undefined }), useTopic: () => undefined, commandRules: async () => ({ ok: true }), editCommandRule: async () => ({ ok: true }) }))

const { RuleLists } = await import('../src/renderer/setup/Permissions')

const RULES: CommandRules = { allow: ['podman *', 'delete in root path'], deny: ['rm -rf /*'] }
const NOTHING: CommandRules = { allow: [], deny: [] }
const SHOWN = (): boolean => false

const draw = (rules: CommandRules | null, { state = {}, text = '', kind = 'allow', off = SHOWN, name = 'Rae' }: { state?: Partial<RulesState>; text?: string; kind?: 'allow' | 'deny'; off?: (row: RowId) => boolean; name?: string | null } = {}) =>
  renderToStaticMarkup(
    <RuleLists
      name={name} section={rules === null ? { show: 'reading' } : { show: 'rules', rules }} state={{ ...FIRST_RULES, ...state }} text={text} kind={kind} off={off}
      onText={() => {}} onKind={() => {}} onChange={() => {}} onAsk={() => {}} onKeep={() => {}} onRetry={() => {}}
    />
  )
const codes = (html: string) => Array.from(html.matchAll(/<code>([^<]*)<\/code>/g), ([, rule]) => rule)
const buttons = (html: string) => Array.from(html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g), ([, attributes = '', name = '']) => `${name}${attributes.includes('disabled') ? ' (disabled)' : ''}`)
const removes = (html: string) => Array.from(html.matchAll(/aria-label="(Remove [^"]*)"/g), ([, label]) => label?.replaceAll('&quot;', '"'))

describe('the Permissions rules', () => {
  it('lists each rule of each list in a code element with its own Remove button, under the list it is in', () => {
    const html = draw(RULES)
    expect(codes(html)).toEqual(['podman *', 'delete in root path', 'rm -rf /*'])
    expect(removes(html)).toEqual(['Remove podman * from Always allowed', 'Remove delete in root path from Always allowed', 'Remove rm -rf /* from Denied'])
    expect(html.indexOf('Always allowed')).toBeLessThan(html.indexOf('podman *'))
    expect(html.indexOf('podman *')).toBeLessThan(html.indexOf('>Denied<'))
  })

  it("says whose rules these are, and what each list does, in plain words", () => {
    const html = draw(RULES)
    expect(html).toContain('Rules for Rae.')
    expect(html).toContain('Hermes runs a command that matches one of these without asking.')
    expect(html).toContain('Hermes never runs a command that matches one of these, even with YOLO on.')
    expect(draw(RULES, { name: null })).toContain('Rules for this bot.')
  })

  it('says each list is empty in words, with no list and no Remove button', () => {
    const html = draw(NOTHING)
    expect(html).toContain('Nothing is always allowed.')
    expect(html).toContain('No commands are denied.')
    expect(html).not.toContain('<ul')
    expect(removes(html)).toEqual([])
    expect(draw({ allow: ['ls'], deny: [] })).toContain('No commands are denied.')
  })

  it('offers Add a rule with a text field, an Allow and a Deny choice with the chosen kind checked, and Add off until there is a rule', () => {
    const html = draw(RULES)
    expect(html).toContain('Add a rule')
    expect(html).toMatch(/<input type="text"[^>]*placeholder="podman \*"/)
    expect(html).toMatch(/<label><input type="radio"[^>]*checked=""[^>]*\/>Allow<\/label>/)
    expect(html).toMatch(/<label><input type="radio"(?![^>]*checked)[^>]*\/>Deny<\/label>/)
    expect(buttons(html)).toContain('Add (disabled)')
    expect(buttons(draw(RULES, { text: 'git push --force*', kind: 'deny' }))).toContain('Add')
    expect(buttons(draw(RULES, { text: 'git push --force*', kind: 'deny' }))).not.toContain('Add (disabled)')
    expect(draw(RULES, { kind: 'deny' })).toMatch(/<label><input type="radio"[^>]*checked=""[^>]*\/>Deny<\/label>/)
  })

  it('says so, and keeps Add off, for a rule the chosen list already holds', () => {
    const html = draw(RULES, { text: ' podman * ', kind: 'allow' })
    expect(html).toContain('That rule is already in the always allowed list.')
    expect(buttons(html)).toContain('Add (disabled)')
    expect(buttons(draw(RULES, { text: 'podman *', kind: 'deny' }))).not.toContain('Add (disabled)')
  })

  it('turns Remove, the field and Add off while a change is on its way', () => {
    const html = draw(RULES, { state: { saving: true }, text: 'ls' })
    expect(buttons(html).filter(name => name.startsWith('Remove'))).toEqual(['Remove (disabled)', 'Remove (disabled)', 'Remove (disabled)'])
    expect(buttons(html)).toContain('Add (disabled)')
    expect(html).toMatch(/<input type="text"[^>]*disabled/)
  })

  it('shows why a change did not happen as an alert under the form, and what a change did for a screen reader', () => {
    expect(draw(RULES, { state: { problem: "Hermes didn't save that change. An administrator may manage this setting." } })).toMatch(/role="alert">Hermes didn&#x27;t save that change\./)
    expect(draw(RULES, { state: { said: 'Removed “ls” from Always allowed.' } })).toContain('<p class="sr" role="status">Removed “ls” from Always allowed.</p>')
  })

  it('asks before a rule goes, in a dialog that names the rule and what Hermes does then', () => {
    const html = draw(RULES, { state: { removing: { kind: 'allow', rule: 'podman *' } } })
    expect(html).toMatch(/<dialog[^>]*class="remove"/)
    expect(html).toContain('Stop always allowing “podman *”?')
    expect(html).toContain('Hermes will ask before it runs a command that matches it')
    expect(buttons(html)).toEqual(expect.arrayContaining(['Cancel', 'Remove rule']))
    expect(draw(RULES)).not.toContain('<dialog')
  })

  it('draws nothing of a row the search hides', () => {
    expect(draw(RULES, { off: row => row === 'denied' })).toMatch(/<div class="row" hidden="">\s*<div class="text"><p class="label"[^>]*>Denied/)
    const hidden = draw(RULES, { off: row => row === 'add-rule' })
    expect(hidden).toMatch(/<form class="row wrapped add-rule" hidden="">/)
  })

  it('says it is reading, and shows no list, until Hermes answers', () => {
    const html = draw(null)
    expect(html).toContain('Asking Hermes…')
    expect(codes(html)).toEqual([])
    expect(html).not.toContain('Add a rule')
  })

  it("shows Hermes's words, and Try again for a read that failed, but not for a Hermes that cannot", () => {
    const failed = renderToStaticMarkup(
      <RuleLists
        name="Rae" section={{ show: 'failed', words: "Highwing couldn't reach Hermes to read its command rules." }} state={FIRST_RULES} text="" kind="allow" off={SHOWN}
        onText={() => {}} onKind={() => {}} onChange={() => {}} onAsk={() => {}} onKeep={() => {}} onRetry={() => {}}
      />
    )
    expect(failed).toMatch(/role="alert">Highwing couldn&#x27;t reach Hermes to read its command rules\./)
    expect(buttons(failed)).toEqual(['Try again'])
    const note = renderToStaticMarkup(
      <RuleLists
        name="Rae" section={{ show: 'note', words: "This Hermes can't show its command rules to Highwing. Update Hermes, then try again." }} state={FIRST_RULES} text="" kind="allow" off={SHOWN}
        onText={() => {}} onKind={() => {}} onChange={() => {}} onAsk={() => {}} onKeep={() => {}} onRetry={() => {}}
      />
    )
    expect(note).toContain('Update Hermes, then try again.')
    expect(buttons(note)).toEqual([])
  })
})

describe('the Permissions page state', () => {
  const read = nextRules(FIRST_RULES, { on: 'read', outcome: { ok: true, value: RULES } })
  const ADD = { change: 'add', kind: 'deny', rule: 'git push --force*' } as const

  it('starts reading, and holds the lists once Hermes answers', () => {
    expect(FIRST_RULES.read).toEqual({ at: 'reading' })
    expect(read.read).toEqual({ at: 'read', rules: RULES })
    expect(rulesSectionOf(read.read)).toEqual({ show: 'rules', rules: RULES })
  })

  it('tells a Hermes that cannot, which is a note, from a read that failed, which can be tried again', () => {
    const cannot = nextRules(FIRST_RULES, { on: 'read', outcome: { ok: false, refusal: { kind: 'unsupported', message: 'Update Hermes.' } } })
    const failed = nextRules(FIRST_RULES, { on: 'read', outcome: { ok: false, refusal: { kind: 'offline', message: 'No answer.' } } })
    expect(rulesSectionOf(cannot.read)).toEqual({ show: 'note', words: 'Update Hermes.' })
    expect(rulesSectionOf(failed.read)).toEqual({ show: 'failed', words: 'No answer.' })
  })

  it('draws the lists Hermes answered with after a change, and says what changed', () => {
    const saving = nextRules(read, { on: 'saving' })
    expect(saving.saving).toBe(true)
    const saved = nextRules(saving, { on: 'saved', edit: ADD, outcome: { ok: true, value: { ...RULES, deny: [...RULES.deny, 'git push --force*'] } } })
    expect(saved).toMatchObject({ saving: false, problem: null, said: 'Added “git push --force*” to Denied.', read: { rules: { deny: ['rm -rf /*', 'git push --force*'] } } })
    const removed = nextRules(saving, { on: 'saved', edit: { change: 'remove', kind: 'allow', rule: 'podman *' }, outcome: { ok: true, value: NOTHING } })
    expect(removed.said).toBe('Removed “podman *” from Always allowed.')
  })

  it('keeps the lists it had, and shows the words, when a change is refused', () => {
    const refused = nextRules(nextRules(read, { on: 'saving' }), { on: 'saved', edit: ADD, outcome: { ok: false, refusal: { kind: 'rejected', message: "Hermes didn't save that change." } } })
    expect(refused).toMatchObject({ saving: false, problem: "Hermes didn't save that change.", said: null, read: { at: 'read', rules: RULES } })
  })

  it('holds a rule for a yes, drops it on No, and clears an old problem when a new one is asked about', () => {
    const asked = nextRules({ ...read, problem: 'Old.' }, { on: 'ask', kind: 'allow', rule: 'podman *' })
    expect(asked).toMatchObject({ removing: { kind: 'allow', rule: 'podman *' }, problem: null })
    expect(nextRules(asked, { on: 'keep' }).removing).toBeNull()
    expect(nextRules(asked, { on: 'saving' }).removing).toBeNull()
  })

  it('starts over for another bot', () => {
    expect(nextRules({ ...read, saving: true, problem: 'x', said: 'y' }, { on: 'otherBot' })).toEqual(FIRST_RULES)
  })
})

describe('rulesWatch', () => {
  const stamps = (...tokens: (string | null)[]) => {
    const left = [...tokens]
    return async (): Promise<CommandOutcome<string>> => {
      const token = left.length > 1 ? left.shift() : left[0]
      return token === null || token === undefined ? { ok: false, refusal: { kind: 'unsupported', message: 'No token.' } } : { ok: true, value: token }
    }
  }

  it('reads once at the start, takes the token first, and reads again only when it moves', async () => {
    const reads: string[] = []
    const watch = rulesWatch({ stamp: stamps('a', 'a', 'a', 'b', 'b', 'c'), read: async () => void reads.push('read') })
    await watch.start()
    expect(reads).toHaveLength(1)
    await watch.look(false)
    await watch.look(false)
    expect(reads, 'the token the start took has not moved').toHaveLength(1)
    await watch.look(false)
    expect(reads).toHaveLength(2)
    await watch.look(false)
    expect(reads, 'the same token again').toHaveLength(2)
    await watch.look(true)
    expect(reads).toHaveLength(3)
  })

  it('reads a change that happened between the token and the first read as soon as it looks again', async () => {
    const reads: string[] = []
    const watch = rulesWatch({ stamp: stamps('a', 'b'), read: async () => void reads.push('read') })
    await watch.start()
    await watch.look(false)
    expect(reads).toHaveLength(2)
  })

  it('reads a Hermes that gives no token when the window comes back, and not on the timer', async () => {
    const reads: string[] = []
    const watch = rulesWatch({ stamp: stamps(null), read: async () => void reads.push('read') })
    await watch.start()
    await watch.look(false)
    await watch.look(false)
    expect(reads).toHaveLength(1)
    await watch.look(true)
    expect(reads).toHaveLength(2)
  })

  it('takes a token after a start that had none, and reads once for it', async () => {
    const reads: string[] = []
    const watch = rulesWatch({ stamp: stamps(null, 'a', 'a'), read: async () => void reads.push('read') })
    await watch.start()
    await watch.look(false)
    await watch.look(false)
    expect(reads).toHaveLength(2)
  })
})

describe('addPlan', () => {
  it('plans an add of the trimmed rule to the chosen list', () => {
    expect(addPlan('  git push --force*  ', 'deny', RULES)).toEqual({ edit: { change: 'add', kind: 'deny', rule: 'git push --force*' }, note: null })
  })

  it('has nothing to say about a blank field, and turns away a rule the chosen list holds, but not the other list', () => {
    expect(addPlan('   ', 'allow', RULES)).toEqual({ edit: null, note: null })
    expect(addPlan('rm -rf /*', 'deny', RULES)).toEqual({ edit: null, note: 'That rule is already in the denied list.' })
    expect(addPlan('rm -rf /*', 'allow', RULES).edit).toEqual({ change: 'add', kind: 'allow', rule: 'rm -rf /*' })
  })

  it('turns away more than one line', () => {
    expect(addPlan('ls\nrm x', 'allow', RULES)).toEqual({ edit: null, note: 'A rule is one line of text.' })
  })
})

describe('removalWords', () => {
  it('says what Hermes does once an allow rule goes, and once a deny rule does', () => {
    expect(removalWords('allow', 'podman *')).toEqual({ title: 'Stop always allowing “podman *”?', detail: 'Hermes will ask before it runs a command that matches it, unless another rule or your approval mode lets it through.', confirm: 'Remove rule' })
    expect(removalWords('deny', 'rm -rf /*').title).toBe('Stop denying “rm -rf /*”?')
    expect(removalWords('deny', 'x').detail).toContain('Hermes will be able to run a command that matches it again.')
  })
})

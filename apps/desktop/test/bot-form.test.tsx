import type { BotDetails, BotId, Bots, ModelOption, Refusal } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BotEditor } from '../src/renderer/bots/BotEditor'
import { BotForm } from '../src/renderer/bots/BotForm'
import { canSubmit, draftOf, editOf, EMPTY_DRAFT, groupModels, nameProblem, nextForm, saveEdit, startForm, type EditCalls } from '../src/renderer/bots/bot-form'
import { APPROVED, fact, listed, NO_PET } from './support/bots'

const model = (id: string, provider: string, providerName: string) => ({ id, provider, providerName }) as ModelOption
const MODELS = { options: [model('fast-small', 'acme', 'Acme'), model('careful-large', 'acme', 'Acme'), model('local-7b', 'local', 'Local')], fallback: null }
const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1]

function drawn(initial = EMPTY_DRAFT, bots: Bots | undefined = APPROVED) {
  return renderToStaticMarkup(
    <BotForm
      title="New bot" submitLabel="Create" initial={initial} problemOf={name => nameProblem(name, bots)} models={MODELS}
      onSubmit={async () => ({ ok: true, value: null })} onClose={() => {}}
    />
  )
}
const submitTag = (markup: string) => markup.match(/<button[^>]*type="submit"[^>]*>/)![0]

describe('nameProblem', () => {
  it.each([
    ['a blank name, which has no words, only no way to send', '', null],
    ['spaces', '   ', null],
    ['a free name', 'Rae', null],
    ['a slash', 'my/bot', "A name can't hold a slash."],
    ['a backslash', 'my\\bot', "A name can't hold a slash."],
    ['a name a bot has', 'research', "There's already a bot called research."],
    ['a name a bot has, as Hermes reads it: trimmed and lowercased', '  Research ', "There's already a bot called research."],
    ['the default bot, in any case', 'DEFAULT', "There's already a bot called default."],
    ['a name that is only a bot\'s display name', 'Timothy · CEO', null]
  ])('says nothing, or what is wrong, for %s', (_, name, words) => {
    expect(nameProblem(name, APPROVED)).toBe(words)
  })

  it('checks every bot of the roster, the featured one and each section', () => {
    const roster = listed(fact('default', 'Emu', { isDefault: true }), fact('a', 'A', { section: 'S' }), fact('b', 'B'))
    expect(['default', 'a', 'b'].map(name => nameProblem(name, roster))).toEqual(["There's already a bot called default.", "There's already a bot called a.", "There's already a bot called b."])
  })

  it('has nothing to check against until Hermes has listed its bots', () => {
    expect(nameProblem('research', { state: 'loading' })).toBeNull()
    expect(nameProblem('research', undefined)).toBeNull()
  })
})

describe('canSubmit', () => {
  it('needs a name with words in it and no problem with it', () => {
    expect(canSubmit({ ...EMPTY_DRAFT, name: '' }, null)).toBe(false)
    expect(canSubmit({ ...EMPTY_DRAFT, name: '  ' }, null)).toBe(false)
    expect(canSubmit({ ...EMPTY_DRAFT, name: 'Rae' }, "There's already a bot called rae.")).toBe(false)
    expect(canSubmit({ ...EMPTY_DRAFT, name: 'Rae' }, null)).toBe(true)
  })
})

describe('the form as it is typed in and answered', () => {
  const typed = { ...EMPTY_DRAFT, name: 'Rae', persona: 'You write short reports.' }
  const refusal = (more: Partial<Refusal> = {}): Refusal => ({ kind: 'rejected', message: 'Hermes said no.', ...more })

  it('keeps every typed value through a refusal, whichever field Hermes names', () => {
    for (const reason of [refusal(), refusal({ field: 'name' })]) {
      const sent = nextForm(startForm(typed), { on: 'sent' })
      expect(sent.send).toEqual({ at: 'sending' })
      const answered = nextForm(sent, { on: 'refused', refusal: reason })
      expect(answered).toEqual({ draft: typed, send: { at: 'refused', refusal: reason } })
    }
  })

  it('drops a refusal with the next edit, except a reason for the name, which stays until the name changes', () => {
    const other = nextForm(startForm(typed), { on: 'refused', refusal: refusal() })
    expect(nextForm(other, { on: 'typed', draft: { ...typed, description: 'More.' } }).send).toEqual({ at: 'editing' })
    const name = nextForm(startForm(typed), { on: 'refused', refusal: refusal({ field: 'name' }) })
    expect(nextForm(name, { on: 'typed', draft: { ...typed, description: 'More.' } }).send).toMatchObject({ at: 'refused' })
    expect(nextForm(name, { on: 'typed', draft: { ...typed, name: 'Rae2' } }).send).toEqual({ at: 'editing' })
  })

  it('stays sending while a field is typed in', () => {
    const sent = nextForm(startForm(typed), { on: 'sent' })
    expect(nextForm(sent, { on: 'typed', draft: { ...typed, description: 'More.' } }).send).toEqual({ at: 'sending' })
  })
})

describe('groupModels', () => {
  it('groups by provider in the order Hermes lists them, each option keeping its place in the list', () => {
    expect(groupModels([model('a', 'x', 'X'), model('b', 'y', 'Y'), model('c', 'x', 'X')]).map(group => [group.label, group.options.map(({ index, option }) => [index, option.id])]))
      .toEqual([['X', [[0, 'a'], [2, 'c']]], ['Y', [[1, 'b']]]])
  })
})

describe('the bot form', () => {
  const markup = drawn()

  it('is a dialog named by its heading, with the four fields named by their labels', () => {
    const [, title] = /aria-labelledby="([^"]+)"/.exec(markup)!
    expect(markup).toContain(`<h2 id="${title}">New bot</h2>`)
    const labels = Array.from(markup.matchAll(/<label for="([^"]+)">([^<]*)<\/label>/g), ([, id, name]) => [id, name])
    expect(labels.map(([, name]) => name)).toEqual(['Name', 'Description', 'Model', 'Persona'])
    const tags = Array.from(markup.matchAll(/<(input|select|textarea)[^>]* id="([^"]+)"/g), ([, tag, id]) => [id, tag])
    expect(tags).toEqual(labels.map(([id], at) => [id, ['input', 'input', 'select', 'textarea'][at]]))
  })

  it("offers Hermes's default first, then each model under its provider", () => {
    expect(markup).toMatch(/<select[^>]*><option value="" selected="">Hermes&#x27;s default<\/option><optgroup label="Acme"><option value="0">fast-small<\/option><option value="1">careful-large<\/option><\/optgroup><optgroup label="Local"><option value="2">local-7b<\/option><\/optgroup><\/select>/)
  })

  it('has Create disabled while the name is blank, and says nothing about it', () => {
    expect(submitTag(markup)).toMatch(/ disabled=""/)
    expect(markup).not.toMatch(/field-words|role="alert"/)
  })

  it('names Create and Cancel, and nothing else, in the one row of buttons', () => {
    expect(Array.from(markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g), ([, name]) => name)).toEqual(['Cancel', 'Create'])
  })

  it('enables Create for a free name, and describes the name by the words about a taken one, which it cannot send', () => {
    expect(submitTag(drawn({ ...EMPTY_DRAFT, name: 'Rae' }))).not.toMatch(/ disabled/)
    const taken = drawn({ ...EMPTY_DRAFT, name: 'Research' })
    expect(submitTag(taken)).toMatch(/ disabled=""/)
    const [, words] = /<input[^>]* aria-describedby="([^"]+)"/.exec(taken)!
    expect(taken).toContain(`<p class="field-words" id="${words}">There&#x27;s already a bot called research.</p>`)
    expect(attr(/<input[^>]*>/.exec(taken)![0], 'aria-invalid')).toBe('true')
  })

  it('shows the text it was started with', () => {
    const started = drawn({ name: 'rae', description: 'Writes the report', model: MODELS.options[1]!, persona: 'You write.' })
    expect(started).toContain('value="rae"')
    expect(started).toContain('value="Writes the report"')
    expect(started).toContain('>You write.</textarea>')
    expect(started).toContain('<option value="1" selected="">careful-large</option>')
  })
})

const RAE: BotDetails = { bot: 'rae' as BotId, name: 'Rae', description: 'Writes the weekly report', persona: 'You write short, plain reports.', revision: 2 }

describe('an edit of a bot', () => {
  const draft = draftOf(RAE)

  it('starts from the details with no model', () => {
    expect(draft).toEqual({ name: 'Rae', description: 'Writes the weekly report', model: null, persona: 'You write short, plain reports.' })
  })

  it('holds only the fields that changed, or nothing', () => {
    expect(editOf(RAE, draft)).toBeNull()
    expect(editOf(RAE, { ...draft, persona: 'You write plainly.' })).toEqual({ persona: 'You write plainly.' })
    expect(editOf(RAE, { ...draft, name: ' Ray ', description: '' })).toEqual({ name: 'Ray', description: '' })
    expect(editOf(RAE, { ...draft, name: ' Rae ' }), 'spaces around the same name are no rename').toBeNull()
  })

  it('takes the fresh draft a clash answers with, and shows the clash until the next edit', () => {
    const fresh = { ...draft, name: 'Robin' }
    const clash: Refusal = { kind: 'conflict', message: 'This bot changed elsewhere.' }
    const sent = nextForm(startForm({ ...draft, name: 'Ray' }), { on: 'sent' })
    const reloaded = nextForm(sent, { on: 'refused', refusal: clash, draft: fresh })
    expect(reloaded).toEqual({ draft: fresh, send: { at: 'refused', refusal: clash } })
    expect(nextForm(reloaded, { on: 'typed', draft: { ...fresh, name: 'Ray' } }).send).toEqual({ at: 'editing' })
  })
})

describe('a Save of the details dialog', () => {
  const draft = draftOf(RAE)
  const CLASH: Refusal = { kind: 'conflict', message: 'This bot changed elsewhere.' }
  const ROBIN: BotDetails = { ...RAE, name: 'Robin', revision: 3 }
  function calls(edited: Awaited<ReturnType<EditCalls['onEdit']>>) {
    const sent: unknown[][] = []
    const described: string[] = []
    const held: EditCalls = {
      onEdit: async (...args) => (sent.push(args), edited),
      onDescribe: async bot => (described.push(bot), { ok: true, value: ROBIN })
    }
    return { held, sent, described }
  }

  it('sends nothing and closes when nothing changed', async () => {
    const { held, sent } = calls({ ok: true, value: undefined })
    expect(await saveEdit(RAE, draft, held)).toEqual({ submitted: { ok: true }, details: RAE })
    expect(sent).toEqual([])
  })

  it('sends only the changed persona, at the revision the dialog was loaded at', async () => {
    const { held, sent, described } = calls({ ok: true, value: undefined })
    expect((await saveEdit(RAE, { ...draft, persona: 'Plain.' }, held)).submitted).toEqual({ ok: true, value: undefined })
    expect(sent).toEqual([['rae', { persona: 'Plain.' }, 2]])
    expect(described).toEqual([])
  })

  it('reads the details again after a clash, and hands the form the fresh fields and the next Save the fresh revision', async () => {
    const { held, described } = calls({ ok: false, refusal: CLASH })
    const saved = await saveEdit(RAE, { ...draft, name: 'Ray' }, held)
    expect(saved).toEqual({ submitted: { ok: false, refusal: CLASH, draft: draftOf(ROBIN) }, details: ROBIN })
    expect(described).toEqual(['rae'])
  })

  it('keeps what was typed after any other refusal', async () => {
    const refusal: Refusal = { kind: 'rejected', message: "Hermes didn't save the persona." }
    const { held, described } = calls({ ok: false, refusal })
    expect(await saveEdit(RAE, { ...draft, persona: 'Plain.' }, held)).toEqual({ submitted: { ok: false, refusal }, details: RAE })
    expect(described).toEqual([])
  })
})

describe('the details dialog', () => {
  const shown = (picture: boolean) => renderToStaticMarkup(
    <BotEditor
      bot={{ id: 'rae' as BotId, name: 'Rae', preview: null, description: null, tone: 'plum', picture, pinned: false, hidden: false }} details={RAE}
      onDescribe={async () => ({ ok: true, value: RAE })} onEdit={async () => ({ ok: true, value: undefined })}
      onPickPicture={async () => ({ ok: true, value: 'cancelled' })} onRemovePicture={async () => ({ ok: true, value: undefined })} pet={NO_PET} onClose={() => {}}
    />
  )
  const markup = shown(true)

  it("is a dialog named by the bot's name, with Name, Description and Persona filled in and no Model field", () => {
    const [, title] = /aria-labelledby="([^"]+)"/.exec(markup)!
    expect(markup).toContain(`<h2 id="${title}">Rae</h2>`)
    expect(Array.from(markup.matchAll(/<label for="[^"]+">([^<]*)<\/label>/g), ([, name]) => name)).toEqual(['Name', 'Description', 'Persona'])
    expect(markup).not.toContain('<select')
    expect(markup).toContain('value="Rae"')
    expect(markup).toContain('value="Writes the weekly report"')
    expect(markup).toContain('>You write short, plain reports.</textarea>')
  })

  it('offers Upload picture and Generate pet picture, and Remove picture only for a bot that has one, ahead of Cancel and Save', () => {
    expect(Array.from(markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g), ([, name]) => name)).toEqual(['Upload picture', 'Generate pet picture', 'Remove picture', 'Cancel', 'Save'])
    expect(shown(false)).not.toContain('Remove picture')
    expect(submitTag(markup)).not.toMatch(/ disabled/)
  })

  it("draws the bot's letter where it has no picture loaded", () => {
    expect(markup).toMatch(/<span class="avatar tone-plum"[^>]*>R<\/span>/)
  })
})

import type { Backup, BotModelSettings, ModelOption } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { FIRST_MODELS, modelsSectionOf, nextModels, type ModelsState } from '../src/renderer/setup/models-view'

vi.mock('../src/renderer/store', () => ({ Epoch: {}, run: async () => ({ ok: true, value: undefined }), useTopic: () => undefined }))

const { ModelRows } = await import('../src/renderer/setup/Models')

const option = (id: string, provider: string, providerName: string): ModelOption => ({ id: id as ModelOption['id'], provider, providerName })
const FAST = option('fast-small', 'acme', 'Acme')
const CAREFUL = option('careful-large', 'acme', 'Acme')
const LOCAL = option('local-7b', 'local', 'Local')
const OPTIONS = [FAST, CAREFUL, LOCAL]

const settings = (backup: Backup, main: ModelOption | null = FAST): BotModelSettings => ({ options: OPTIONS, main, backup })
const page = (read: BotModelSettings, state: Partial<ModelsState> = {}) =>
  renderToStaticMarkup(<ModelRows settings={read} state={{ ...FIRST_MODELS, ...state }} onPickMain={() => {}} onPickBackup={() => {}} onKeep={() => {}} />)
const selects = (html: string) => Array.from(html.matchAll(/<select[^>]*>([\s\S]*?)<\/select>/g), ([, inner]) =>
  Array.from((inner as string).matchAll(/<option[^>]*>([^<]*)<\/option>/g), ([whole, label]) => `${label}${/selected=""/.test(whole) ? ' *' : ''}`))

describe('the Models rows', () => {
  it("checks the bot's default and its backup, grouped by provider, with No backup first and the default left out of the backups", () => {
    const html = page(settings({ state: 'set', model: LOCAL, more: 0 }))
    expect(selects(html)).toEqual([['fast-small *', 'careful-large', 'local-7b'], ['No backup', 'careful-large', 'local-7b *']])
    expect(html).toContain('<optgroup label="Acme">')
  })

  it('checks No backup for a bot with none', () => {
    expect(selects(page(settings({ state: 'none' })))[1]).toEqual(['No backup *', 'careful-large', 'local-7b'])
  })

  it('shows a model the list does not hold as itself', () => {
    expect(selects(page(settings({ state: 'set', model: { id: 'old-9' as ModelOption['id'], provider: 'gone' }, more: 0 })))[1]).toEqual(['No backup', 'old-9 *', 'careful-large', 'local-7b'])
  })

  it('says how many more backups Hermes holds, and that No backup removes them', () => {
    expect(page(settings({ state: 'set', model: CAREFUL, more: 1 }))).toContain('Hermes also has 1 more backup set outside Highwing. No backup removes them all.')
    expect(page(settings({ state: 'set', model: CAREFUL, more: 2 }))).toContain('Hermes also has 2 more backups set outside Highwing.')
    expect(page(settings({ state: 'set', model: CAREFUL, more: 0 }))).not.toContain('more backup')
  })

  it("shows Hermes's words in place of the backup list when it can't say the backup", () => {
    const html = page(settings({ state: 'unknown', words: "This Hermes can't change backup models from Highwing." }))
    expect(html).toContain('This Hermes can&#x27;t change backup models from Highwing.')
    expect(selects(html)).toHaveLength(1)
  })

  it('asks for the second yes under the default, with the model to keep', () => {
    const html = page(settings({ state: 'none' }), { confirm: { model: CAREFUL, message: 'careful-large costs more per message.' } })
    expect(html).toMatch(/role="alert"><p>careful-large costs more per message.<\/p><button[^>]*>Use careful-large anyway<\/button><button[^>]*>Keep fast-small<\/button>/)
  })

  it('turns both lists off while a save runs', () => {
    expect(page(settings({ state: 'none' }), { saving: 'backup' }).match(/<select[^>]*disabled/g)).toHaveLength(2)
  })
})

describe('the Models page state', () => {
  const read = nextModels(FIRST_MODELS, { on: 'read', outcome: { ok: true, value: settings({ state: 'none' }) } })

  it('drops the last bot\'s confirm and problem when another bot is picked', () => {
    const asked = nextModels(nextModels(read, { on: 'confirm', model: CAREFUL, message: 'Sure?' }), { on: 'failed', row: 'backup', words: 'No.' })
    expect(asked).toMatchObject({ confirm: { model: CAREFUL }, problem: { row: 'backup', words: 'No.' } })
    expect(nextModels(asked, { on: 'otherBot' })).toEqual(FIRST_MODELS)
  })

  it('clears a problem and a pending confirm when a new save starts, and keeps the read', () => {
    const failed = nextModels(nextModels(read, { on: 'confirm', model: CAREFUL, message: 'Sure?' }), { on: 'failed', row: 'main', words: 'No.' })
    expect(nextModels(failed, { on: 'saving', row: 'backup' })).toEqual({ ...read, saving: 'backup' })
  })

  it('says the bot has no models when Hermes lists none, and leaves an unsupported Hermes in its own words', () => {
    expect(modelsSectionOf('Research', { at: 'read', settings: { options: [], main: null, backup: { state: 'none' } } })).toEqual({ show: 'note', words: 'This Hermes lists no models for Research.' })
    expect(modelsSectionOf('Research', { at: 'refused', words: "This Hermes doesn't support that.", unsupported: true })).toEqual({ show: 'note', words: "This Hermes doesn't support that." })
    expect(modelsSectionOf('Research', { at: 'refused', words: 'Hermes refused: boom', unsupported: false })).toEqual({ show: 'failed', words: 'Hermes refused: boom' })
  })
})

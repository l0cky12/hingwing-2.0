import { botsIn, type Bot, type BotId, type Refusal } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GroupForm } from '../src/renderer/groups/GroupForm'
import { groupFormOf, nextGroupForm, startGroupForm, type GroupFormEvent } from '../src/renderer/groups/group-form'
import { fact, listed } from './support/bots'

const ROSTER = listed(
  fact('default', 'Ada', { isDefault: true, description: 'Default bot. General help' }), fact('sam', 'Sam', { description: 'Finds and fixes bugs' }),
  fact('rae', 'Rae'), fact('juno', 'Juno'), fact('otto', 'Otto'), fact('mia', 'Mia'), fact('kit', 'Kit')
)
const OFFERED: readonly Bot[] = ROSTER.state === 'listed' ? botsIn(ROSTER.roster) : []
const DIALOG = '0f7c2a52-6a5f-4a0b-9d0e-6a3a4f1f2c11'
const tick = (...bots: string[]): GroupFormEvent[] => bots.map(bot => ({ on: 'toggled', bot: bot as BotId }))
const after = (...events: GroupFormEvent[]) => events.reduce(nextGroupForm, startGroupForm(DIALOG))
const viewAfter = (...events: GroupFormEvent[]) => groupFormOf(after(...events), OFFERED)
const named: GroupFormEvent = { on: 'named', name: ' Launch plan ' }
const refusal = (more: Partial<Refusal> = {}): Refusal => ({ kind: 'rejected', message: 'Hermes said no.', ...more })

describe('the New group chat dialog, as it is filled in', () => {
  it('names the picked bots in the order they answer, the roster\'s, whatever order they were ticked in', () => {
    const view = viewAfter(named, ...tick('juno', 'default', 'sam'))
    expect(view.tally).toBe('3 picked: Ada, Sam and Juno')
    expect(view.draft).toEqual({ group: DIALOG, name: 'Launch plan', bots: ['default', 'sam', 'juno'] })
  })

  it('sends nothing while the name is blank or fewer than 2 bots are picked, and says to pick more', () => {
    expect(viewAfter(...tick('default', 'sam')).draft, 'no name').toBeNull()
    expect(viewAfter({ on: 'named', name: '   ' }, ...tick('default', 'sam')).draft, 'a blank name').toBeNull()
    expect(viewAfter(named, ...tick('default')).draft, 'one bot').toBeNull()
    expect(viewAfter(named).tally).toBe('Pick at least 2 bots')
    expect(viewAfter(named, ...tick('sam')).tally).toBe('Pick at least 2 bots')
    expect(viewAfter(named, ...tick('default', 'sam', 'sam')).tally, 'a second tick takes a bot out').toBe('Pick at least 2 bots')
  })

  it('locks every other bot once 6 are picked, and takes no seventh', () => {
    const six = tick('default', 'sam', 'rae', 'juno', 'otto', 'mia')
    const view = viewAfter(named, ...six, ...tick('kit'))
    expect(view.draft?.bots).toEqual(['default', 'sam', 'rae', 'juno', 'otto', 'mia'])
    expect(view.rows.filter(row => row.locked).map(row => row.bot.name)).toEqual(['Kit'])
    expect(viewAfter(named, ...six, ...tick('mia')).rows.some(row => row.locked), 'one out, all open again').toBe(false)
  })

  it('narrows the list by name and keeps every picked bot, the hidden ones too', () => {
    const view = viewAfter(named, ...tick('default', 'juno'), { on: 'searched', query: ' JU ' })
    expect(view.rows.map(row => [row.bot.name, row.picked])).toEqual([['Juno', true]])
    expect(view.tally).toBe('2 picked: Ada and Juno')
    expect(view.draft?.bots).toEqual(['default', 'juno'])
  })

  it('leaves out a picked bot the list no longer offers', () => {
    const state = after(named, ...tick('default', 'sam', 'otto'))
    expect(groupFormOf(state, OFFERED.filter(bot => bot.id !== 'otto')).draft?.bots).toEqual(['default', 'sam'])
  })
})

describe('the New group chat dialog, as Hermes answers', () => {
  const filled = [named, ...tick('default', 'sam')]
  const sentAndRefused = (refused: Refusal, ...more: GroupFormEvent[]) => after(...filled, { on: 'sent' }, { on: 'refused', refusal: refused }, ...more)

  it('sends a create whose answer was lost under the same id, so Hermes makes one group', () => {
    const state = sentAndRefused(refusal({ kind: 'offline', message: "Highwing isn't connected to Hermes right now." }))
    expect(groupFormOf(state, OFFERED).draft?.group).toBe(viewAfter(...filled).draft?.group)
  })

  it('sends the next try after a refusal under a new id, never one Hermes refused', () => {
    const once = sentAndRefused(refusal({ kind: 'conflict' }))
    const twice = nextGroupForm(nextGroupForm(once, { on: 'sent' }), { on: 'refused', refusal: refusal({ kind: 'conflict' }) })
    const ids = [after(...filled), once, twice].map(state => groupFormOf(state, OFFERED).draft?.group)
    expect(new Set(ids).size).toBe(3)
  })

  it('puts Hermes\'s words about the bots under the list, and any other words above the buttons', () => {
    expect(groupFormOf(sentAndRefused(refusal({ field: 'members', message: "Hermes can't seat these bots." })), OFFERED)).toMatchObject({ membersWords: "Hermes can't seat these bots.", otherWords: null })
    expect(groupFormOf(sentAndRefused(refusal()), OFFERED)).toMatchObject({ membersWords: null, otherWords: 'Hermes said no.' })
  })

  it('drops the words once the name or the bots change, and keeps them through a search', () => {
    const refused = (...more: GroupFormEvent[]) => groupFormOf(sentAndRefused(refusal({ field: 'members' }), ...more), OFFERED).membersWords
    expect(refused({ on: 'searched', query: 'ju' })).toBe('Hermes said no.')
    expect(refused(...tick('juno'))).toBeNull()
    expect(refused({ on: 'named', name: 'Release' })).toBeNull()
  })
})

describe('the New group chat dialog, drawn', () => {
  const markup = renderToStaticMarkup(<GroupForm offered={OFFERED} onCreate={async () => ({ ok: true, value: undefined })} onClose={() => {}} />)
  const decoded = (text: string) => text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
  const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1]
  const textOf = (id: string | undefined) => decoded(new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(markup)?.[1] ?? '')
  const boxes = markup.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? []

  it('is a dialog named New group chat and described by its rule', () => {
    const dialog = /<dialog[^>]*>/.exec(markup)![0]
    expect(textOf(attr(dialog, 'aria-labelledby'))).toBe('New group chat')
    expect(textOf(attr(dialog, 'aria-describedby'))).toBe('Pick 2 to 6 bots. You can’t change who’s in the group later.')
  })

  it('has a Name field, a Search bots field and one real checkbox per offered bot, named by the bot and described by what it is for', () => {
    const name = /<input[^>]*>/.exec(markup.slice(markup.indexOf('>Name</label>')))![0]
    expect(attr(name, 'maxLength')).toBe('200')
    expect(markup).toMatch(/<input[^>]*aria-label="Search bots"[^>]*placeholder="Search bots"/)
    expect(boxes.map(box => textOf(attr(box, 'aria-labelledby')))).toEqual(['Ada', 'Sam', 'Rae', 'Juno', 'Otto', 'Mia', 'Kit'])
    expect(textOf(attr(boxes[0]!, 'aria-describedby'))).toBe('Default bot. General help')
    expect(attr(boxes[2]!, 'aria-describedby'), 'Rae has nothing written about her').toBeUndefined()
    expect(textOf(/<ul[^>]*>/.exec(markup)![0].match(/aria-labelledby="([^"]*)"/)?.[1])).toBe('Bots')
  })

  it('says how many are picked, and keeps Create group chat off until a group could be made', () => {
    expect(markup).toContain('<p class="tally" role="status">Pick at least 2 bots</p>')
    expect(markup).toMatch(/<button type="submit" class="primary" disabled="">Create group chat<\/button>/)
    expect(markup).toMatch(/<button type="button">Cancel<\/button>/)
  })
})

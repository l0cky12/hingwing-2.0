import type { BotId, Bots, GroupId, OpenChat, SessionId } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BotItems, BotMenu } from '../src/renderer/bots/BotPicker'
import { listOf, NEW_BOT_BLOCKS, NO_BOTS, NOTES } from '../src/renderer/bots/roster-view'
import { APPROVED, fact, listed } from './support/bots'

const showing = (bot: string | null, opening: string | null = null): OpenChat => ({
  shown: { kind: 'chat', bot: bot as BotId | null, sessionId: 's1' as SessionId },
  opening: opening === null ? null : { kind: 'bot', bot: opening as BotId },
  missing: null
})
const render = (bots: Bots | undefined, open: OpenChat | undefined, refused: string | null = null) =>
  renderToStaticMarkup(<BotMenu bots={bots} open={open} refused={refused} onPick={() => {}} />)
const decoded = (text: string) => text.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')
const attr = (tag: string, name: string) => {
  const value = new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1]
  return value === undefined ? undefined : decoded(value)
}
const toggleOf = (markup: string) => /<button[^>]*class="bot-pick-button"[^>]*>/.exec(markup)![0]
const spokenText = (html: string) => decoded(html.replace(/<span[^>]*aria-hidden="true"[^>]*>.*?<\/span>/gs, '').replace(/<[^>]*>/g, ''))
const nameOf = (markup: string) => spokenText(/<button[^>]*class="bot-pick-button"[^>]*>(.*?)<\/button>/s.exec(markup)![1]!)
const reasonOf = (markup: string) => {
  const id = attr(toggleOf(markup), 'aria-describedby')
  const said = id === undefined ? undefined : new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(markup)?.[1]
  return said === undefined ? null : decoded(said)
}

describe('the bot picker', () => {
  it('is named for the open bot, and is a menu button for the listed roster', () => {
    const markup = render(APPROVED, showing('research'))
    expect(nameOf(markup)).toBe('Bot: Research')
    const toggle = toggleOf(markup)
    expect(attr(toggle, 'aria-haspopup')).toBe('menu')
    expect(attr(toggle, 'aria-expanded')).toBe('false')
    expect(attr(toggle, 'aria-disabled')).toBeUndefined()
    expect(attr(markup.match(/<div[^>]*class="bot-pick"[^>]*>/)![0], 'data-state')).toBe('listed')
  })

  it('is named for a hidden bot the user opened', () => {
    expect(nameOf(render(listed(fact('old', 'Old Helper', { hidden: true }), fact('scout', 'Scout')), showing('old')))).toBe('Bot: Old Helper')
  })

  it('still offers the hidden bot a group chat was opened over', () => {
    const overHidden: OpenChat = { shown: { kind: 'group', group: 'launch-plan' as GroupId, over: 'old' as BotId }, opening: null, missing: null }
    const markup = render(listed(fact('old', 'Old Helper', { hidden: true })), overHidden)
    expect(nameOf(markup)).toBe('Bot: Old Helper')
    expect(attr(toggleOf(markup), 'aria-disabled')).toBeUndefined()
  })

  it('reads "Choose a bot" when there is no bot of the roster to name', () => {
    expect(nameOf(render(APPROVED, showing(null))), 'a bound launch shows a chat with no bot').toBe('Choose a bot')
    expect(nameOf(render(APPROVED, { shown: null, opening: null, missing: null })), 'nothing shown yet').toBe('Choose a bot')
    expect(nameOf(render(APPROVED, showing('gone'))), 'a bot the roster does not list').toBe('Choose a bot')
    expect(nameOf(render({ state: 'unsupported' }, showing('default'))), 'a Hermes with no profiles.list').toBe('Choose a bot')
    expect(nameOf(render(undefined, showing('default'))), 'the roster still loading').toBe('Choose a bot')
    expect(attr(toggleOf(render(APPROVED, showing(null))), 'aria-disabled'), 'a pick is still for Hermes to refuse').toBeUndefined()
  })

  it('is turned off, still focusable, and says why, while the roster is not listed', () => {
    const cases: readonly (readonly [Bots | undefined, string])[] = [
      [undefined, NEW_BOT_BLOCKS.loading],
      [{ state: 'loading' }, NEW_BOT_BLOCKS.loading],
      [{ state: 'offline' }, NOTES.offline],
      [{ state: 'unsupported' }, NOTES.unsupported],
      [{ state: 'refused' }, NOTES.refused],
      [listed(), NO_BOTS]
    ]
    for (const [bots, reason] of cases) {
      const markup = render(bots, showing('default'))
      const toggle = toggleOf(markup)
      expect(attr(toggle, 'aria-disabled'), reason).toBe('true')
      expect(attr(toggle, 'disabled'), reason).toBeUndefined()
      expect(attr(toggle, 'title'), reason).toBe(reason)
      expect(reasonOf(markup), reason).toBe(reason)
    }
    expect(reasonOf(render(APPROVED, showing('default')))).toBeNull()
  })

  it('is busy while Hermes has not answered a pick', () => {
    expect(attr(toggleOf(render(APPROVED, showing('default', 'research'))), 'aria-busy')).toBe('true')
    expect(attr(toggleOf(render(APPROVED, showing('default'))), 'aria-busy')).toBeUndefined()
  })

  it("says Hermes's refusal of the latest pick as an alert beside the picker, and nothing without one", () => {
    expect(render(APPROVED, showing(null), "This Hermes can't switch bots.")).toMatch(/<p class="err bot-pick-err" role="alert">This Hermes can&#x27;t switch bots\.<\/p>$/)
    expect(render(APPROVED, showing(null))).not.toContain('role="alert"')
  })
})

describe("the bot picker's items", () => {
  const list = listOf(APPROVED, null)
  if (list.show !== 'roster') throw new Error('the approved roster lists')
  const items = (selected: string | null) => renderToStaticMarkup(<BotItems list={list} selected={selected as BotId | null} idPrefix="p" onPick={() => {}} />)
  const radios = (markup: string) => Array.from(markup.matchAll(/<button([^>]*)>(.*?)<\/button>/gs), ([, tag, inner]) => ({
    name: attr(tag!, 'aria-label') ?? spokenText(inner!), checked: attr(tag!, 'aria-checked'), role: attr(tag!, 'role')
  }))

  it('lists the default bot first, then each section, as the Bots column does', () => {
    const markup = items('default')
    expect(radios(markup).map(item => item.name)).toEqual(['Emu, default bot', 'dr eggbot', 'Research', 'Timothy · CEO', 'Hermes', 'highwing'])
    expect(radios(markup).every(item => item.role === 'menuitemradio')).toBe(true)
    const groups = Array.from(markup.matchAll(/<div role="group" aria-labelledby="([^"]*)">/g), ([, id]) => new RegExp(`id="${id}"[^>]*>([^<]*)<`).exec(markup)?.[1])
    expect(groups).toEqual(['New section', 'Unassigned'])
    expect(markup).not.toMatch(/<h\d/)
  })

  it('checks the open bot, and no other', () => {
    expect(radios(items('research')).filter(item => item.checked === 'true').map(item => item.name)).toEqual(['Research'])
    expect(radios(items('default')).filter(item => item.checked === 'true').map(item => item.name)).toEqual(['Emu, default bot'])
    expect(radios(items(null)).filter(item => item.checked === 'true')).toEqual([])
  })

  it('draws the check from the same state as aria-checked', () => {
    const checks = Array.from(items('research').matchAll(/<button[^>]*aria-checked="(true|false)"[^>]*><span class="mode-check" aria-hidden="true">(.*?)<\/span>/gs), ([, checked, mark]) => [checked, mark !== ''])
    expect(checks).toEqual(checks.map(([checked]) => [checked, checked === 'true']))
    expect(checks.filter(([, marked]) => marked)).toHaveLength(1)
  })
})

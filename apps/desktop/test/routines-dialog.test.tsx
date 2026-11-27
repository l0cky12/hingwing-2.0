import { BOT_TONES, type Bot, type BotId, type RoutineId, type Routines } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoutinesDialog } from '../src/renderer/bots/RoutinesDialog'

const RESEARCH: Bot = { id: 'research' as BotId, name: 'Research', preview: null, description: null, tone: BOT_TONES[0], picture: false, pinned: false, hidden: false }
const shown = (routines: Routines | undefined) => renderToStaticMarkup(<RoutinesDialog bot={RESEARCH} routines={routines} onClose={() => {}} />)
const text = (markup: string) => markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

describe('the routines dialog', () => {
  it('is named for the bot and says it is reading until Hermes answers for that bot', () => {
    for (const routines of [undefined, null, { bot: 'timothy' as BotId, list: { state: 'listed', routines: [] } } as const]) {
      const markup = shown(routines)
      expect(markup).toContain('aria-label="Routines for Research"')
      expect(markup).toMatch(/<p role="status">Reading routines…<\/p>/)
    }
  })

  it('lists each job with its schedule in words, and marks a paused one', () => {
    const markup = shown({
      bot: RESEARCH.id,
      list: { state: 'listed', routines: [
        { id: 'a' as RoutineId, name: 'Morning brief', schedule: 'Weekdays at 09:00', paused: false },
        { id: 'b' as RoutineId, name: 'Backup check', schedule: 'Every 6 hours', paused: true }
      ] }
    })
    expect(markup).toContain('<ul aria-label="Routines">')
    expect(markup.match(/<li>.*?<\/li>/g)?.map(text)).toEqual(['Morning brief Weekdays at 09:00', 'Backup check Every 6 hours Paused'])
  })

  it('says how to make a routine by asking the bot when it has none', () => {
    expect(text(shown({ bot: RESEARCH.id, list: { state: 'listed', routines: [] } }))).toContain(
      'Research has no routines yet. To make one, ask Research in a chat to do something on a schedule, such as “Every weekday at 9am, summarise my inbox.”'
    )
  })

  it("shows Hermes's refusal as an alert", () => {
    expect(shown({ bot: RESEARCH.id, list: { state: 'refused', message: "This Hermes can't list routines for Highwing." } })).toContain(
      '<p class="form-refused" role="alert">This Hermes can&#x27;t list routines for Highwing.</p>'
    )
  })
})

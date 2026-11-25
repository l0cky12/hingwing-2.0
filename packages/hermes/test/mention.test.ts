import { describe, expect, it } from 'vitest'
import type { Bot } from '../src/domain/bots'
import { mentionedBots, mentionOf, typedMention } from '../src/domain/mention'

const bot = (id: string, name: string) => ({ id, name }) as Pick<Bot, 'id' | 'name'>
const SAM = bot('sam', 'Sam')
const RAE = bot('rae-writer', 'Rae')
const CEO = bot('timothy', 'Timothy · CEO')
const BOTS = [SAM, RAE, CEO]
const ids = (text: string) => mentionedBots(text, BOTS).map(found => found.id)

describe('mentionedBots', () => {
  it('finds a bot named after an @ at the start of the text or after whitespace', () => {
    expect(ids('@Rae write the report')).toEqual(['rae-writer'])
    expect(ids('Please ask @Sam\nand then @Rae')).toEqual(['sam', 'rae-writer'])
  })

  it('reads the shown name or the id, in any case', () => {
    expect(ids('ask @rae')).toEqual(['rae-writer'])
    expect(ids('ask @RAE-WRITER')).toEqual(['rae-writer'])
    expect(ids('ask @timothy')).toEqual(['timothy'])
  })

  it('reads a name with a space only inside quotes', () => {
    expect(ids('ask @"Timothy · CEO" for a budget')).toEqual(['timothy'])
    expect(ids('ask @"timothy · ceo"')).toEqual(['timothy'])
    expect(ids('ask @Timothy · CEO'), 'the bare word is its id').toEqual(['timothy'])
    expect(mentionedBots('ask @Night shift', [bot('late', 'Night shift')])).toEqual([])
  })

  it('drops punctuation that trails a bare name', () => {
    expect(ids('thanks, @Sam.')).toEqual(['sam'])
    expect(ids('(cc @Rae), @Sam!?')).toEqual(['rae-writer', 'sam'])
  })

  it('keeps trailing punctuation that belongs to the name', () => {
    const dotted = bot('dot', 'Rae.')
    expect(mentionedBots('ask @Rae.', [RAE, dotted])).toEqual([dotted])
  })

  it('names each bot once, in the order the text first names them', () => {
    expect(ids('@Sam and @Rae, then @sam again')).toEqual(['sam', 'rae-writer'])
  })

  it('never reads an address or a name nobody has', () => {
    expect(ids('mail me at sam@example')).toEqual([])
    expect(ids('mail rae@Sam')).toEqual([])
    expect(ids('ask @Nobody and @ Sam')).toEqual([])
  })
})

describe('mentionOf', () => {
  it('is the name after an @, with a space to go on typing', () => {
    expect(mentionOf(RAE, BOTS)).toBe('@Rae ')
  })

  it('quotes a name that holds a space, and the text it gives reads back as that bot', () => {
    expect(mentionOf(CEO, BOTS)).toBe('@"Timothy · CEO" ')
    expect(mentionedBots(`Ask ${mentionOf(CEO, BOTS)}now`, BOTS)).toEqual([CEO])
  })

  it('falls back to the id for a name that holds a quote', () => {
    const quoted = bot('q', 'The "Boss"')
    expect(mentionOf(quoted, [quoted])).toBe('@q ')
    expect(mentionedBots(mentionOf(quoted, [quoted]), [quoted])).toEqual([quoted])
  })

  it('gives the id of a bot whose name another bot shares, so each pick reads back as the bot picked', () => {
    const twin = bot('sam-two', 'Sam')
    const both = [SAM, twin]
    expect(both.map(held => mentionOf(held, both))).toEqual(['@Sam ', '@sam-two '])
    expect(both.map(held => mentionedBots(mentionOf(held, both), both))).toEqual([[SAM], [twin]])
  })

  it('gives the id of a bot whose name is another bot\'s id', () => {
    const named = bot('x', 'sam')
    expect(mentionOf(named, [SAM, named])).toBe('@x ')
    expect(mentionedBots('@sam', [SAM, named])).toEqual([SAM])
  })
})

describe('typedMention', () => {
  it('is the @ word the text ends in, and where it starts', () => {
    expect(typedMention('Ask @Ra')).toEqual({ at: 4, query: 'Ra' })
    expect(typedMention('@')).toEqual({ at: 0, query: '' })
  })

  it('runs past spaces inside an open quote, and drops the quote', () => {
    expect(typedMention('Ask @"Timothy ·')).toEqual({ at: 4, query: 'Timothy ·' })
  })

  it('is nothing once the word ended, inside an address, or after a closed quote', () => {
    expect(typedMention('Ask @Rae ')).toBeNull()
    expect(typedMention('mail me at sam@example')).toBeNull()
    expect(typedMention('Ask @"Timothy · CEO"')).toBeNull()
  })
})

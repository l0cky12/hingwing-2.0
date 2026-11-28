import type { ChatMade, LibraryItem, SessionId } from '@highwing/hermes/domain'
import { describe, expect, it } from 'vitest'
import { whenWords, joinLibrary, libraryOf } from '../src/thread-view'

const isWeb = (url: string) => /^https?:/.test(url)
const chat = (id: string, rows: ChatMade['rows']): ChatMade => ({ sessionId: id as SessionId, title: `Chat ${id}`, rows })
const shown = (items: readonly LibraryItem[]) => items.map(item => [item.kind, item.name, item.at])

describe('libraryOf', () => {
  it('lists the files, images and links the chats made, newest first', () => {
    const items = libraryOf([chat('new', [
      { at: 3000, wrote: ['/home/rae/notes.md', '/home/rae/chart.svg'] },
      { at: 4000, said: 'Here is the chart ![Sales by week](https://example.com/sales.png) and the [source data](https://example.com/data).' }
    ])], isWeb)
    expect(shown(items), 'a reply keeps its reading order, and so do the files of one write').toEqual([
      ['image', 'Sales by week', 4000], ['link', 'source data', 4000], ['file', 'notes.md', 3000], ['image', 'chart.svg', 3000]
    ])
    expect(items.map(item => item.where)).toEqual([
      { on: 'web', url: 'https://example.com/sales.png' }, { on: 'web', url: 'https://example.com/data' },
      { on: 'hermes', path: '/home/rae/notes.md' }, { on: 'hermes', path: '/home/rae/chart.svg' }
    ])
  })

  it('keeps one item per file or address across chats, from its newest mention', () => {
    const items = libraryOf([
      chat('new', [{ at: 5000, wrote: ['/home/rae/notes.md'] }, { at: 5100, said: 'See https://example.com/docs' }]),
      chat('old', [{ at: 1000, wrote: ['/home/rae/notes.md'] }, { at: 1100, said: 'Read [the docs](https://example.com/docs) and [the guide](https://example.com/guide)' }])
    ], isWeb)
    expect(shown(items)).toEqual([['link', 'https://example.com/docs', 5100], ['file', 'notes.md', 5000], ['link', 'the guide', 1100]])
    expect(items.find(item => item.kind === 'file')?.chat.sessionId).toBe('new')
  })

  it('puts a newer chat first on a tie, then a later row, and an item with no time last', () => {
    const items = libraryOf([
      chat('newer', [{ at: 2000, wrote: ['/a.md'] }, { at: 2000, wrote: ['/b.md'] }, { at: null, wrote: ['/undated.md'] }]),
      chat('older', [{ at: 2000, wrote: ['/c.md'] }])
    ], isWeb)
    expect(items.map(item => item.name)).toEqual(['b.md', 'a.md', 'c.md', 'undated.md'])
  })

  it('takes only addresses the pane shows, and nothing in a code block', () => {
    const items = libraryOf([chat('c', [{
      at: 1, said: 'Mail [me](mailto:rae@example.com), see [notes](notes.md) and ![local](file:///etc/passwd).\n\n```\nhttps://example.com/in-code\n```'
    }])], isWeb)
    expect(items).toEqual([])
  })

  it('names a link by its words, a bare address by itself, a web image by its alt text or its file, and a Windows file by its own name', () => {
    const items = libraryOf([chat('c', [
      { at: 3, wrote: ['C:\\Users\\rae\\report.docx'] },
      { at: 2, said: '![](https://example.com/img/plot.png) **[bold words](https://example.com/b)**' },
      { at: 1, said: '<https://example.com/auto>' }
    ])], isWeb)
    expect(shown(items)).toEqual([['file', 'report.docx', 3], ['image', 'plot.png', 2], ['link', 'bold words', 2], ['link', 'https://example.com/auto', 1]])
  })

  it('gives each item an id that names its target', () => {
    const [file, web] = libraryOf([chat('c', [{ at: 2, wrote: ['/a.md'] }, { at: 1, said: '[x](https://example.com/x)' }])], isWeb)
    expect([file?.id, web?.id]).toEqual(['hermes:/a.md', 'web:https://example.com/x'])
  })
})

describe('joinLibrary', () => {
  it('adds an older step to the list, keeping the newer mention of what both name', () => {
    const held = libraryOf([chat('new', [{ at: 5000, wrote: ['/notes.md'] }])], isWeb)
    const older = libraryOf([chat('old', [{ at: 1000, wrote: ['/notes.md', '/plan.md'] }])], isWeb)
    const joined = joinLibrary(held, older)
    expect(shown(joined)).toEqual([['file', 'notes.md', 5000], ['file', 'plan.md', 1000]])
    expect(joined[0]?.chat.sessionId).toBe('new')
  })
})

describe('whenWords', () => {
  const clock = { now: Date.UTC(2026, 10, 24, 15, 0), timeZone: 'UTC' }

  it('says today, yesterday, a day of this year, or a day of another year, with the time', () => {
    expect(whenWords(Date.UTC(2026, 10, 24, 14, 5), clock)).toBe('Today 14:05')
    expect(whenWords(Date.UTC(2026, 10, 23, 9, 12), clock)).toBe('Yesterday 09:12')
    expect(whenWords(Date.UTC(2026, 10, 2, 9, 12), clock)).toBe('Mon 2 Nov 09:12')
    expect(whenWords(Date.UTC(2025, 10, 2, 9, 12), clock)).toBe('Sun 2 Nov 2025 09:12')
  })
})

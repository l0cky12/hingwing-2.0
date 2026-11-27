import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Preview as PreviewState, PreviewContent } from '../src/ipc-contract'
import { Preview } from '../src/renderer/preview/Preview'

const REPORT = '/tmp/hermes-proto-work/report.csv'
const open = (content: PreviewContent, file = true, address = REPORT): Extract<PreviewState, { state: 'open' }> =>
  ({ state: 'open', layout: 'beside', title: 'report.csv', address, file, content })
const render = (preview: Extract<PreviewState, { state: 'open' }>) => renderToStaticMarkup(<Preview preview={preview} />)
const statusOf = (html: string) => /<p class="preview-rows" role="status">([^<]*)<\/p>/.exec(html)?.[1]

describe('a CSV in the pane', () => {
  it('draws the header as column headers and each row as cells, ragged rows as they are', () => {
    const html = render(open({ kind: 'table', table: { header: ['name', 'total'], rows: [['Alice', '120'], ['Bob']], total: 2 } }))
    expect(html).toContain('<thead><tr><th scope="col">name</th><th scope="col">total</th></tr></thead>')
    expect(html).toContain('<tbody><tr><td>Alice</td><td>120</td></tr><tr><td>Bob</td></tr></tbody>')
    expect(statusOf(html)).toBe('2 rows')
  })

  it.each([
    [{ header: ['n'], rows: Array.from({ length: 5000 }, () => ['1']), total: 20_000 }, 'Showing the first 5,000 of 20,000 rows'],
    [{ header: ['n'], rows: [['1']], total: 1 }, '1 row'],
    [{ header: ['n'], rows: [], total: 0 }, 'No rows']
  ])('counts its rows', (table, words) => {
    expect(statusOf(render(open({ kind: 'table', table })))).toBe(words)
  })
})

describe("the pane's way out", () => {
  const bar = (html: string) => /<header[^>]*>(.*)<\/header>/.exec(html)?.[1] ?? ''

  it('opens a file in its own program, and a web page in the browser', () => {
    const table = open({ kind: 'table', table: { header: [], rows: [], total: 0 } })
    expect(bar(render(table))).toContain('>Open</button>')
    expect(bar(render(open({ kind: 'page', load: { at: 'shown' } }, false, 'https://example.com/')))).toContain('>Open in browser</button>')
  })

  it("moves beside the reason when the file can't show", () => {
    const html = render(open({ kind: 'page', load: { at: 'failed', reason: 'report.csv is 12.4 MB. Highwing previews a CSV up to 10 MB.' } }))
    expect(bar(html)).not.toContain('>Open</button>')
    expect(html).toContain('<p>report.csv is 12.4 MB. Highwing previews a CSV up to 10 MB.</p><button type="button">Open</button>')
  })

  it('offers nothing for a file on the Hermes machine', () => {
    const html = render(open({ kind: 'page', load: { at: 'failed', reason: 'This file is on hermes-host.' } }, false))
    expect(html).not.toContain('>Open</button>')
  })
})

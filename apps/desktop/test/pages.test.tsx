import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Pages } from '../src/renderer/chat/Pages'

describe('the pages a turn made', () => {
  it('draws a card for each page, titled, with its file name and an Open named for it', () => {
    const html = renderToStaticMarkup(<Pages pages={[{ path: '/w/site/index.html', title: 'Q3 report', version: 't1/0' }, { path: '/w/board.html', title: 'board.html', version: 't1/1' }]} />)
    expect(html).toContain('<section class="page-card" aria-label="Q3 report"><div class="page-card-text"><h3>Q3 report</h3><p title="/w/site/index.html">index.html</p></div><button type="button" aria-label="Open Q3 report">Open</button></section>')
    expect(html).toContain('aria-label="Open board.html"')
  })

  it('draws nothing for a turn that made none', () => {
    expect(renderToStaticMarkup(<Pages pages={[]} />)).toBe('')
  })
})

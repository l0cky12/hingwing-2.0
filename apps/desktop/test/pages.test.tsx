import type { SessionId } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { reloadsPane, type PaneSeen } from '../src/renderer/chat/page-reload'
import { NewestPagesContext, Pages } from '../src/renderer/chat/Pages'

describe('the pages a turn made', () => {
  it('draws a card for each page, titled, with its file name and an Open named for it', () => {
    const html = renderToStaticMarkup(<Pages pages={[{ path: '/w/site/index.html', title: 'Q3 report', version: 't1/0' }, { path: '/w/board.html', title: 'board.html', version: 't1/1' }]} />)
    expect(html).toContain('<section class="page-card" aria-label="Q3 report" data-page-path="/w/site/index.html" data-page-version="t1/0"><div class="page-card-text"><h3>Q3 report</h3><p title="/w/site/index.html">index.html</p></div><button type="button" class="page-open" aria-label="Open Q3 report">Open</button></section>')
    expect(html).toContain('aria-label="Open board.html"')
  })

  it('draws nothing for a turn that made none', () => {
    expect(renderToStaticMarkup(<Pages pages={[]} />)).toBe('')
  })

  it('points an older card at the newer version below, and leaves the newest card as it was', () => {
    const drawn = (version: string) => renderToStaticMarkup(
      <NewestPagesContext value={new Map([['/w/a.html', 't2/1']])}>
        <Pages pages={[{ path: '/w/a.html', title: 'Report', version }]} />
      </NewestPagesContext>
    )
    const older = drawn('t1/0')
    expect(older).toContain('class="page-card older"')
    expect(older).toMatch(/<button type="button" class="page-newer"><svg aria-hidden="true"[^>]*>.*<\/svg>Newer version below<\/button>/)
    expect(older).toContain('aria-label="Open Report"')
    expect(drawn('t2/1')).not.toContain('Newer version below')
  })
})

describe('reloading the open page when its chat writes it again', () => {
  const seen = (version: string | undefined, path = '/w/a.html', session = 's1'): PaneSeen => ({ session: session as SessionId, path, version })

  it('reloads when the same chat names a new version of the page the pane still shows', () => {
    expect(reloadsPane(seen('t1/0'), seen('t2/1'))).toBe(true)
  })

  it('does not reload on first sight, or when the pane closes', () => {
    expect(reloadsPane(null, seen('t2/1'))).toBe(false)
    expect(reloadsPane(seen('t1/0'), null)).toBe(false)
  })

  it('does not reload for the same version', () => {
    expect(reloadsPane(seen('t1/0'), seen('t1/0'))).toBe(false)
  })

  it('does not reload when the pane moved to another page', () => {
    expect(reloadsPane(seen('t1/0'), seen('t2/1', '/w/b.html'))).toBe(false)
  })

  it('does not reload when the chat changed', () => {
    expect(reloadsPane(seen('t1/0'), seen('t2/1', '/w/a.html', 's2'))).toBe(false)
  })

  it('does not reload when no card in the chat names the page, before or after', () => {
    expect(reloadsPane(seen(undefined), seen('t2/1'))).toBe(false)
    expect(reloadsPane(seen('t1/0'), seen(undefined))).toBe(false)
  })
})

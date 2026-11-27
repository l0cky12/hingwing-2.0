import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FilesHereContext } from '../src/renderer/chat/FilePath'
import { PageCard } from '../src/renderer/chat/PageCard'

const page = { path: '/w/report.html', label: 'Weekly sign-ups', title: 'Weekly sign-ups' }

describe('a page card', () => {
  it('offers Open for a page on this computer', () => {
    expect(renderToStaticMarkup(<PageCard page={page} nodeKey="k" />)).toContain('aria-label="Open Weekly sign-ups"')
  })

  it('on another machine shows the page with no Open', () => {
    const html = renderToStaticMarkup(
      <FilesHereContext value={false}>
        <PageCard page={page} nodeKey="k" />
      </FilesHereContext>
    )
    expect(html).toContain('Weekly sign-ups')
    expect(html).toContain('report.html')
    expect(html).not.toContain('Open')
  })
})

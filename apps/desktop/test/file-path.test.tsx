import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FilePath } from '../src/renderer/chat/FilePath'

describe('a file path', () => {
  it.each(['report.csv', 'data.TSV', 'report.pdf', 'index.html'])('offers Preview beside %s', name => {
    expect(renderToStaticMarkup(<FilePath path={`/w/${name}`} findId="f" />)).toContain(`aria-label="Preview ${name}">Preview</button>`)
  })

  it('offers no Preview for a file the pane cannot show', () => {
    expect(renderToStaticMarkup(<FilePath path="/w/notes.md" findId="f" />)).not.toContain('Preview')
  })
})

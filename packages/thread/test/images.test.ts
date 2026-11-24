import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '../src/thread-view'

const inlineOf = (source: string) => {
  const block = parseMarkdown(source)[0]
  if (block?.kind !== 'paragraph') throw new Error('expected a paragraph')
  return block.inline
}

describe('Markdown images', () => {
  it('reads ![alt](url) as an image with the label as its alt text', () => {
    expect(inlineOf('![a chart](x.png)')).toEqual([{ t: 'image', src: 'x.png', alt: 'a chart' }])
  })

  it('keeps [label](url) a link', () => {
    expect(inlineOf('[a chart](x.png)')).toEqual([{ t: 'link', href: 'x.png', children: [{ t: 'text', v: 'a chart' }] }])
  })

  it('uses the plain text of a styled label as the alt', () => {
    expect(inlineOf('![a **bold** chart](x.png)')).toEqual([{ t: 'image', src: 'x.png', alt: 'a bold chart' }])
  })

  it('leaves an unclosed image as text until the closing paren arrives', () => {
    expect(inlineOf('![a](x.png')).toEqual([{ t: 'text', v: '![a](x.png' }])
    expect(inlineOf('![a](x.png)')).toEqual([{ t: 'image', src: 'x.png', alt: 'a' }])
  })

  it('keeps an image inside a link label', () => {
    expect(inlineOf('[![logo](l.png)](https://example.com)')).toEqual([
      { t: 'link', href: 'https://example.com', children: [{ t: 'image', src: 'l.png', alt: 'logo' }] }
    ])
  })
})

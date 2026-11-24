import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Session } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { parseMarkdown, proseLeaves, threadView } from '../src/thread-view'

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

describe('the images fixture played through the real client', () => {
  it('settles with the reply image and the tool image as image nodes', async () => {
    const fixture = loadFixture(fileURLToPath(new URL('../../../fixtures/images.jsonl', import.meta.url)))
    let last: Session | undefined
    for await (const { session } of play(fixture)) last = session
    const turn = threadView(last as Session, { now: 0, timeZone: 'UTC' }).turns.at(-1)
    expect(turn?.end.kind).toBe('done')
    const images = (turn?.nodes ?? []).flatMap(node => (node.kind === 'prose' ? proseLeaves(parseMarkdown(node.markdown)) : []))
      .flatMap(leaf => ('kind' in leaf ? [] : leaf.filter(inline => inline.t === 'image')))
    expect(images).toEqual([{ t: 'image', src: 'https://example.com/signups-chart.png', alt: 'a chart' }])
    const steps = (turn?.nodes ?? []).flatMap(node => (node.kind === 'step' ? [node.step] : node.kind === 'group' ? node.steps : []))
    expect(steps.map(step => step.image)).toEqual(['/tmp/hermes-proto-work/dashboard.png'])
  })
})

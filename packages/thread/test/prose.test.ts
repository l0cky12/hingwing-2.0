import { describe, expect, it } from 'vitest'
import { parseMarkdown, type Inline } from '../src/thread-view'

const text = (v: string): Inline => ({ t: 'text', v })
const paragraph = (inline: readonly Inline[]) => ({ kind: 'paragraph' as const, inline })
const item = (value: string) => [paragraph([text(value)])]

describe('prose', () => {
  it('reads a line over dashes as a level-two heading and a line over equals as a level-one heading', () => {
    expect(parseMarkdown('Next steps\n----------\nbody')).toEqual([
      { kind: 'heading', level: 2, inline: [text('Next steps')] },
      paragraph([text('body')])
    ])
    expect(parseMarkdown('Title\n==========\nbody')).toEqual([
      { kind: 'heading', level: 1, inline: [text('Title')] },
      paragraph([text('body')])
    ])
  })

  it('reads a dashed rule between bullets as a rule that ends the list', () => {
    expect(parseMarkdown('- one\n- - -\n- two')).toEqual([
      { kind: 'list', ordered: false, start: 1, items: [item('one')] },
      { kind: 'rule' },
      { kind: 'list', ordered: false, start: 1, items: [item('two')] }
    ])
  })

  it('keeps an address inside a link label as text of that one link', () => {
    expect(parseMarkdown('[**https://example.org**](https://example.com)')).toEqual([
      paragraph([{
        t: 'link',
        href: 'https://example.com',
        children: [{ t: 'strong', children: [text('https://example.org')] }]
      }])
    ])
  })
})

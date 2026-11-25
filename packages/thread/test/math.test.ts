import { describe, expect, it } from 'vitest'
import { leafText, parseMarkdown, proseLeaves, type Inline } from '../src/thread-view'

const inlineOf = (source: string): readonly Inline[] => {
  const [block, ...rest] = parseMarkdown(source)
  if (block?.kind !== 'paragraph' || rest.length > 0) throw new Error(`expected one paragraph from ${JSON.stringify(source)}`)
  return block.inline
}
const text = (v: string): Inline => ({ t: 'text', v })
const math = (tex: string, display = false): Inline => ({ t: 'math', tex, display })

describe('math in a reply', () => {
  it('reads $a+b$ as inline math', () => {
    expect(inlineOf('so $a+b$ holds')).toEqual([text('so '), math('a+b'), text(' holds')])
  })

  it('reads \\(a\\) as inline math', () => {
    expect(inlineOf('so \\(a\\) holds')).toEqual([text('so '), math('a'), text(' holds')])
  })

  it('leaves prices as text', () => {
    expect(inlineOf('costs $5 and $10')).toEqual([text('costs $5 and $10')])
    expect(inlineOf('$5-$10')).toEqual([text('$5-$10')])
    expect(inlineOf('costs $5 and $10 or $x$')).toEqual([text('costs $5 and $10 or '), math('x')])
  })

  it('reads $$x$$ on its own line as one display formula', () => {
    expect(parseMarkdown('Then:\n$$x$$\nso.')).toEqual([
      { kind: 'paragraph', inline: [text('Then:')] },
      { kind: 'paragraph', inline: [math('x', true)] },
      { kind: 'paragraph', inline: [text('so.')] }
    ])
  })

  it('reads a display formula over several lines as one formula, not a list', () => {
    expect(parseMarkdown('$$\nx\n+ y\n$$')).toEqual([{ kind: 'paragraph', inline: [math('x\n+ y', true)] }])
    expect(parseMarkdown('\\[\n\\frac{a}{b}\n\\]')).toEqual([{ kind: 'paragraph', inline: [math('\\frac{a}{b}', true)] }])
  })

  it('reads $$x$$ inside a line as display math in that paragraph', () => {
    expect(inlineOf('$$x$$ and more')).toEqual([math('x', true), text(' and more')])
  })

  it('keeps math inside code as code', () => {
    expect(inlineOf('`$x$`')).toEqual([{ t: 'code', v: '$x$' }])
    expect(parseMarkdown('```\n$$x$$\n```')).toEqual([{ kind: 'code', lang: null, text: '$$x$$', open: false }])
    expect(inlineOf('costs $10. Write `$x$` here')).toEqual([text('costs $10. Write '), { t: 'code', v: '$x$' }, text(' here')])
  })

  it('leaves an unclosed formula as text while it streams', () => {
    expect(inlineOf('$a+b')).toEqual([text('$a+b')])
    expect(inlineOf('$$x$')).toEqual([text('$$x$')])
    expect(parseMarkdown('$$\n\\frac{a}')).toEqual([{ kind: 'paragraph', inline: [text('$$'), { t: 'break' }, text('\\frac{a}')] }])
  })

  it('leaves escaped dollars and brackets as text', () => {
    expect(inlineOf('\\$5')).toEqual([text('$5')])
    expect(inlineOf('see \\[x\\] here')).toEqual([text('see [x] here')])
  })

  it('reads a star inside math as part of the formula, not emphasis', () => {
    expect(inlineOf('*let $a*b$ be*')).toEqual([{ t: 'em', children: [text('let '), math('a*b'), text(' be')] }])
  })

  it('gives find the TeX source of a formula', () => {
    expect(proseLeaves(parseMarkdown('so $\\frac{a}{b}$ holds')).map(leafText)).toEqual(['so \\frac{a}{b} holds'])
  })
})

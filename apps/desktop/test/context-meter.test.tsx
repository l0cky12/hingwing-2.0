import type { ContextFill } from '@highwing/hermes/domain'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ContextMeter, shortCount } from '../src/renderer/composer/ContextMeter'

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const USAGE = JSON.parse(read('../../../fixtures/usage/errand.json')) as { readonly breakdown: { readonly context_percent: number } }

const fill = (percent: number, estimated = false): ContextFill => ({ used: percent * 2000, max: 200_000, percent, estimated })
const render = (context: ContextFill, stale = false) =>
  renderToStaticMarkup(<ContextMeter fill={context} stale={stale} onBreakdown={() => new Promise(() => {})} />)
const nameOf = (markup: string) => / aria-label="([^"]*)"/.exec(markup)?.[1]
const textOf = (markup: string) => markup.replace(/<[^>]*>/g, '')

describe('the context meter', () => {
  it('shows the percent Hermes names as text, in its name and on its face', () => {
    const markup = render(fill(USAGE.breakdown.context_percent))
    expect(nameOf(markup)).toBe('Context 34% full')
    expect(textOf(markup)).toBe('34%')
  })

  it('says "about" when Hermes estimated the fill', () => {
    const markup = render(fill(34, true))
    expect(nameOf(markup)).toBe('Context about 34% full')
    expect(textOf(markup)).toBe('about 34%')
  })

  it('says a window above 80 percent is nearly full, in words as well as colour', () => {
    const markup = render(fill(87))
    expect(nameOf(markup)).toBe('Context 87% full, nearly full')
    expect(textOf(markup)).toBe('87%, nearly full')
    expect(markup).toMatch(/class="meter near"/)
    expect(nameOf(render(fill(80)))).toBe('Context 80% full')
  })

  it('keeps its value and says it is stale when the chat is not live', () => {
    const markup = render(fill(34, true), true)
    expect(nameOf(markup)).toBe('Context about 34% full (stale)')
    expect(textOf(markup)).toBe('about 34% (stale)')
  })

  it('is closed until pressed', () => {
    expect(render(fill(34))).toMatch(/aria-expanded="false"/)
    expect(render(fill(34))).not.toMatch(/role="dialog"/)
  })

  it('shortens token counts', () => {
    expect([950, 1204, 6000, 68_000, 200_000, 1_250_000].map(shortCount)).toEqual(['950', '1.2k', '6k', '68k', '200k', '1.3M'])
  })

  it('names no money in its source', () => {
    expect(read('../src/renderer/composer/ContextMeter.tsx')).not.toMatch(/[$€£¥] ?\d|cost|price|credit/i)
  })
})

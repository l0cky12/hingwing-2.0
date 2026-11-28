import type { BotMemory } from '@highwing/hermes/domain'
import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MemoryFiles } from '../src/renderer/bots/BotMemory'
import { TabRow, TABS } from '../src/renderer/bots/BotPanel'

const memory: BotMemory = {
  files: [
    { name: 'MEMORY.md', entries: ['Keeps the budget in the shared drive.', 'Sends the summary\non Fridays.'], used: 1234, cap: 2200 },
    { name: 'USER.md', entries: [], used: 0, cap: 1375 }
  ]
}
const ready = (held: BotMemory) => renderToStaticMarkup(<MemoryFiles view={{ state: 'ready', memory: held }} />)

describe('the Memory tab', () => {
  it('says it is reading while Hermes answers', () => {
    const html = renderToStaticMarkup(<MemoryFiles view={{ state: 'loading' }} />)
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('Reading memory…')
  })

  it("says Hermes's words when it cannot read memory, as an alert", () => {
    const html = renderToStaticMarkup(<MemoryFiles view={{ state: 'refused', message: "This Hermes can't show memory yet." }} />)
    expect(html).toMatch(/role="alert"[^>]*>This Hermes can&#x27;t show memory yet\.</)
  })

  it('shows MEMORY.md then USER.md, each named and described', () => {
    const html = ready(memory)
    expect(html.indexOf('<h3>MEMORY.md</h3>')).toBeGreaterThan(-1)
    expect(html.indexOf('<h3>MEMORY.md</h3>')).toBeLessThan(html.indexOf('<h3>USER.md</h3>'))
    expect(html).toContain('What Hermes remembers about its work')
    expect(html).toContain('What Hermes remembers about you')
  })

  it('draws a meter per file with how full it is, named and written out in the same words', () => {
    const html = ready(memory)
    expect(html.match(/<meter /g)).toHaveLength(2)
    expect(html).toMatch(/<meter [^>]*min="0"[^>]*max="2200"[^>]*value="1234"[^>]*aria-label="MEMORY\.md: 1,234 of 2,200 characters"/)
    expect(html).toMatch(/<meter [^>]*max="1375"[^>]*value="0"[^>]*aria-label="USER\.md: 0 of 1,375 characters"/)
    expect(html).toContain('>MEMORY.md: 1,234 of 2,200 characters</p>')
  })

  it('puts the meter in its high region from nine tenths of the cap, and not below', () => {
    const highOf = (used: number) => Number(/high="(\d+)"/.exec(ready({ files: [{ name: 'MEMORY.md', entries: ['x'], used, cap: 1000 }, memory.files[1]] }))![1])
    expect(899 > highOf(899)).toBe(false)
    expect(900 > highOf(900)).toBe(true)
    expect(1000 > highOf(1000)).toBe(true)
  })

  it('lists each entry whole, and says so when a file has none', () => {
    const html = ready(memory)
    expect(html).toContain('<li>Keeps the budget in the shared drive.</li>')
    expect(html).toContain('<li>Sends the summary\non Fridays.</li>')
    expect(html).toMatch(/<h3>USER\.md<\/h3>.*Nothing yet\./s)
  })

  it('shows the size without a meter when Hermes gave no cap', () => {
    const html = ready({ files: [{ ...memory.files[0], cap: null }, { ...memory.files[1], cap: null }] })
    expect(html).not.toContain('<meter')
    expect(html).toContain('MEMORY.md: 1,234 characters')
    expect(html).toContain("Highwing couldn&#x27;t read how much this file may hold from Hermes, so it has no meter.")
  })

  it('shows a cap of 0 as written words, with no meter and no claim that the cap was unread', () => {
    const html = ready({ files: [{ ...memory.files[0], used: 0, entries: [], cap: 0 }, memory.files[1]] })
    expect(html).toContain('MEMORY.md: 0 of 0 characters')
    expect(html.match(/<meter/g)).toHaveLength(1)
    expect(html).not.toContain('couldn&#x27;t read how much')
  })

  it('offers nothing to change', () => {
    expect(ready(memory)).not.toContain('<button')
  })

  it('keeps the line breaks of an entry', () => {
    const css = readFileSync(new URL('../src/renderer/styles/app.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.memory-entries li \{[^}]*white-space: pre-wrap/)
  })
})

describe('the panel tabs', () => {
  it('are Details, Routines and Memory, in that order', () => {
    const html = renderToStaticMarkup(<TabRow tabs={TABS} selected="memory" onSelect={() => {}} />)
    expect([...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map(match => match[1])).toEqual(['Details', 'Routines', 'Memory'])
    expect(html).toMatch(/aria-selected="true" tabindex="0">Memory</)
  })
})

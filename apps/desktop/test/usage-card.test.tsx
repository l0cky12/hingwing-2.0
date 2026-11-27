import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/renderer/store', () => ({ Epoch: {}, run: async () => ({ ok: true, value: undefined }), useTopic: () => undefined }))

const { UsageCard } = await import('../src/renderer/setup/Settings')

const CSS = readFileSync(new URL('../src/renderer/styles/app.css', import.meta.url), 'utf8')
const GAUGE = 'Session (5h)  [|||       ]  34% used  ·  resets in 3h 10m'

const whiteSpaceFor = (classes: readonly string[]) =>
  Array.from(CSS.matchAll(/([^{}]+)\{([^}]*)\}/g)).flatMap(([, selector, body]) =>
    selector!.split(',').some(one => classes.some(name => one.trim().endsWith(`.${name}`)))
      ? Array.from(body!.matchAll(/white-space:\s*([\w-]+)/g), ([, value]) => value!)
      : [])

describe("Settings' Usage page", () => {
  it("draws a gauge Hermes reports with every space kept, so its bar reads as full as Hermes drew it", () => {
    const html = renderToStaticMarkup(<UsageCard view={{ state: 'reported', lines: ['Acme Pro', GAUGE] }} />)
    const drawn = new RegExp(`<p class="([^"]*)">${GAUGE.replace(/[[\]|()]/g, '\\$&')}</p>`).exec(html)
    expect(drawn, 'the gauge is drawn as Hermes sent it').not.toBeNull()
    expect(whiteSpaceFor(drawn![1]!.split(' '))).toContainEqual(expect.stringMatching(/^(pre|pre-wrap|break-spaces)$/))
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'

const page = vi.hoisted(() => ({ dark: false }))
const load = vi.hoisted(() => {
  let open = () => {}
  const opened = new Promise<void>(resolve => { open = resolve })
  return { opened, open: () => open() }
})
const mermaid = vi.hoisted(() => {
  let fill = ''
  let queue: Promise<unknown> = Promise.resolve()
  const held = new Map<string, () => void>()
  return {
    held,
    initialize: (config: { themeVariables: { primaryColor: string } }) => { fill = config.themeVariables.primaryColor },
    render: (_id: string, source: string) => {
      const next = queue.then(async () => {
        const drawnWith = fill
        if (source.startsWith('held')) await new Promise<void>(release => held.set(source, release))
        return { svg: `<svg data-fill="${drawnWith}">${source}</svg>` }
      })
      queue = next
      return next
    }
  }
})

vi.mock('mermaid', async () => {
  await load.opened
  return { default: mermaid }
})
vi.mock('dompurify', () => ({ default: { sanitize: (svg: string) => svg } }))
vi.stubGlobal('matchMedia', () => ({ matches: page.dark, addEventListener: () => {}, removeEventListener: () => {} }))
vi.stubGlobal('document', { documentElement: {} })
vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (name: string) => (name === '--signal-soft' ? (page.dark ? 'dark-fill' : 'light-fill') : 'x') }))

const { drawDiagram, drawnBefore } = await import('../src/renderer/chat/diagrams')
const flush = () => new Promise(done => setTimeout(done, 0))

afterEach(() => { page.dark = false })

describe('diagrams drawn across a theme switch', () => {
  it('draws in the palette the page has once Mermaid loads, after a switch while it loads', async () => {
    const drawing = drawDiagram('during load')
    await flush()
    page.dark = true
    load.open()
    await drawing
    expect(drawnBefore('during load', 'light')).toEqual({ status: 'drawing' })
    expect(drawnBefore('during load', 'dark')).toMatchObject({ status: 'drawn', svg: expect.stringContaining('data-fill="dark-fill"') })
  })

  it('keeps each drawing under the palette Mermaid drew it in, while earlier renders still hold the queue', async () => {
    await drawDiagram('loads Mermaid')
    const first = drawDiagram('held first')
    await vi.waitFor(() => expect(mermaid.held.has('held first')).toBe(true))
    const queued = drawDiagram('second')
    await flush()
    page.dark = true
    const afterSwitch = drawDiagram('third')
    await flush()
    mermaid.held.get('held first')!()
    await Promise.all([first, queued, afterSwitch])

    for (const source of ['held first', 'second', 'third']) {
      for (const palette of ['light', 'dark'] as const) {
        const drawing = drawnBefore(source, palette)
        if (drawing.status === 'drawn') expect(drawing.svg, `${source} cached as ${palette}`).toContain(`data-fill="${palette}-fill"`)
      }
    }
    expect(drawnBefore('third', 'dark')).toMatchObject({ status: 'drawn' })
  })
})

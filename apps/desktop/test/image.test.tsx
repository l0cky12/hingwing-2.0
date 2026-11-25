import type { SessionId } from '@highwing/hermes/domain'
import type { StepView } from '@highwing/thread'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ImageSessionContext, ImageView, settle } from '../src/renderer/chat/Image'
import { Step } from '../src/renderer/chat/Step'
import { Markdown } from '../src/renderer/chat/text'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const WEB = { kind: 'web', url: 'https://example.com/c.png' } as const
const answering = (outcome: Awaited<ReturnType<Parameters<typeof settle>[1]['image']>>) => ({ image: vi.fn(async () => outcome) })

const render = (source: string) => renderToStaticMarkup(<Markdown source={source} caret={false} nodeKey="t1/0" />)

describe('settling an image request', () => {
  it('turns the bytes main answers with into a blob url', async () => {
    const bridge = answering({ ok: true, type: 'image/png', bytes: PNG })
    const state = await settle(WEB, bridge)
    expect(bridge.image).toHaveBeenCalledWith(WEB)
    expect(state).toMatchObject({ s: 'ready', url: expect.stringMatching(/^blob:/) })
    if (state.s === 'ready') {
      const blob = await (await fetch(state.url)).blob()
      expect(blob.type).toBe('image/png')
      expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PNG)
      URL.revokeObjectURL(state.url)
    }
  })

  it.each([
    ['a refusal', answering({ ok: false })],
    ['a bridge that throws', { image: vi.fn(async () => { throw new Error('gone') }) }]
  ])('fails on %s', async (_, bridge) => {
    await expect(settle(WEB, bridge)).resolves.toEqual({ s: 'failed' })
  })

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'mailto:a@example.com', 'c.png'])('fails on %s without asking main', async url => {
    const bridge = answering({ ok: true, type: 'image/png', bytes: PNG })
    await expect(settle({ kind: 'web', url }, bridge)).resolves.toEqual({ s: 'failed' })
    await expect(settle(null, bridge)).resolves.toEqual({ s: 'failed' })
    expect(bridge.image).not.toHaveBeenCalled()
  })
})

describe('an image in a reply', () => {
  it('holds its place with a slot while main has not answered, and is no link', () => {
    const markup = render('Here is the chart.\n\n![a chart](https://example.com/c.png)')
    expect(markup).toContain('class="pic-slot"')
    expect(markup).not.toContain('<a ')
    expect(markup).not.toContain('![')
  })

  it('shows the alt text and the failure for a url main would refuse, with no trip to main', () => {
    const markup = render('![a chart](file:///etc/passwd)')
    expect(markup).toContain('a chart')
    expect(markup).toContain('Couldn&#x27;t load this image.')
    expect(markup).not.toContain('<img')
  })

  it('keeps a link a link', () => {
    expect(render('[a chart](https://example.com/c.png)')).toContain('<a href="https://example.com/c.png" target="_blank" rel="noreferrer" aria-expanded="false">a chart</a>')
  })
})

describe('the image view', () => {
  it('is a button that opens a dialog and holds the picture under its alt text, with no label of its own', () => {
    const markup = renderToStaticMarkup(<ImageView state={{ s: 'ready', url: 'blob:app://x/1' }} alt="a chart" />)
    const button = /<button[^>]*>/.exec(markup)![0]
    expect(button).toContain('aria-haspopup="dialog"')
    expect(button).toContain('type="button"')
    expect(button).not.toContain('aria-label')
    expect(markup).toMatch(/<button[^>]*><img alt="a chart" src="blob:app:\/\/x\/1"\/><\/button>/)
  })

  it('says it could not load, under the alt text when there is one', () => {
    expect(renderToStaticMarkup(<ImageView state={{ s: 'failed' }} alt="a chart" />)).toMatch(/a chart.*Couldn&#x27;t load this image\./)
    expect(renderToStaticMarkup(<ImageView state={{ s: 'failed' }} alt="" />)).not.toContain('pic-alt')
  })
})

describe('a tool step with an image', () => {
  const step = (image: string | null): StepView => ({ key: 't1/0', title: [{ t: 'text', v: 'Ran ' }, { t: 'code', v: 'screenshot' }], state: 'done', stat: null, duration: null, record: null, image })
  const draw = (image: string | null, session: SessionId | null) =>
    renderToStaticMarkup(<ImageSessionContext value={session}><Step step={step(image)} live={false} elapsed={null} open={false} onToggle={() => {}} /></ImageSessionContext>)

  it('draws the image under the head row, even though the step has no record', () => {
    const markup = draw('/tmp/shot.png', 's1' as SessionId)
    expect(markup).toMatch(/class="head".*<\/div><div class="step-image"><span class="pic-slot"/)
  })

  it('names a failed image by the file it was', () => {
    expect(draw('/tmp/shot.png', null)).toContain('shot.png')
    expect(draw('/tmp/shot.png', null)).toContain('Couldn&#x27;t load this image.')
  })

  it('draws nothing for a step with no image', () => {
    expect(draw(null, 's1' as SessionId)).not.toContain('step-image')
  })
})

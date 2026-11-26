import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Session, ToolItem } from '@highwing/hermes/domain'
import { loadFixture, play } from '@highwing/hermes/testing'
import { pageOf, threadView } from '../src/thread-view'

const settled = async (name: string) => {
  let last: Session | undefined
  for await (const { session } of play(loadFixture(fileURLToPath(new URL(`../../../fixtures/${name}`, import.meta.url))))) last = session
  return threadView(last as Session, { now: 0, timeZone: 'UTC' }).turns.at(-1)
}

const DONE: ToolItem['status'] = { s: 'done', durationS: null, diffs: [], result: { kind: 'text', text: '{"success": true}', isError: false, clipped: 0 }, image: null }
const preview = (args: ToolItem['args'], status: ToolItem['status'] = DONE): ToolItem =>
  ({ kind: 'tool', id: 'call-1' as ToolItem['id'], name: 'desktop_preview', args, status })

describe('a page the bot built and showed', () => {
  it('draws as its own card under Hermes label, after the step that wrote it', async () => {
    const turn = await settled('page.jsonl')
    expect(turn?.nodes.map(node => node.kind)).toEqual(['prose', 'step', 'page', 'prose'])
    const page = turn?.nodes.find(node => node.kind === 'page')
    expect(page?.kind === 'page' && page.page).toEqual({ path: '/tmp/hermes-proto-work/pages/report.html', label: 'Weekly sign-ups', title: 'Weekly sign-ups' })
  })

  it('leaves a web page Hermes showed as a step', async () => {
    const turn = await settled('preview.jsonl')
    expect(turn?.nodes.some(node => node.kind === 'page')).toBe(false)
  })

  it('takes the file name when Hermes gave no label', () => {
    expect(pageOf(preview({ action: 'open', url: '/tmp/site/report.html', label: '  ' }))).toEqual({ path: '/tmp/site/report.html', label: null, title: 'report.html' })
    expect(pageOf(preview({ action: 'open', url: 'file:///tmp/my%20site/index.html' }))).toEqual({ path: '/tmp/my site/index.html', label: null, title: 'index.html' })
  })

  it('is no page for a web address, a close, a failed open or one still running', () => {
    expect(pageOf(preview({ action: 'open', url: 'http://localhost:5173/' }))).toBeNull()
    expect(pageOf(preview({ action: 'close', url: '/tmp/site/report.html' }))).toBeNull()
    expect(pageOf(preview({ action: 'open', url: '/tmp/site/report.html' }, { ...DONE, result: { kind: 'text', text: 'no', isError: true, clipped: 0 } } as ToolItem['status']))).toBeNull()
    expect(pageOf(preview({ action: 'open', url: '/tmp/site/report.html' }, { s: 'running', note: null }))).toBeNull()
  })
})

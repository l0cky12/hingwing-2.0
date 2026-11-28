import type { CommandOutcome } from '@highwing/hermes/domain'
import type { ThreadNode } from '@highwing/thread'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { NONE_OPEN } from '../src/renderer/chat/open'

const ran: unknown[] = []
let outcome: CommandOutcome<unknown> = { ok: true, value: undefined }
vi.mock('../src/renderer/store', () => ({ Epoch: {}, run: async (command: unknown) => (ran.push(command), outcome), useTopic: () => undefined }))

const { Node } = await import('../src/renderer/chat/Thread')
const { openSettingsOn, takeOpeningPage } = await import('../src/renderer/setup/settings-page')

const answered = (chosenAlways: boolean): ThreadNode => ({
  kind: 'prompt', key: 't1/4', card: { state: 'answered', words: 'You allowed commands like this from now on.', command: 'rm -rf drafts', chosenAlways }
})
const draw = (node: ThreadNode) => renderToStaticMarkup(<Node node={node} endTone={null} elapsed={null} open={NONE_OPEN} onToggle={() => {}} onAnswer={async () => undefined} onAskAgain={async () => false} helpers={null} />)

describe('the card of an approval answered with Always allow', () => {
  it('points at Permissions, with a button that opens it, under the words of the answer, and does not say Hermes saved a rule', () => {
    const html = draw(answered(true))
    expect(html).toContain('You allowed commands like this from now on.')
    expect(html).not.toMatch(/saved/i)
    expect(html).toMatch(/See or remove it in Permissions\. <button type="button" class="open-rules">Open Permissions<\/button>/)
    expect(html.indexOf('You allowed commands')).toBeLessThan(html.indexOf('See or remove it in Permissions.'))
  })

  it('says nothing of a rule for any other answer', () => {
    const html = draw(answered(false))
    expect(html).not.toContain('See or remove it in Permissions.')
    expect(html).not.toContain('Open Permissions')
  })
})

describe('opening Settings on a page', () => {
  it('opens Settings, which takes the page it was asked for once', () => {
    ran.length = 0
    outcome = { ok: true, value: undefined }
    openSettingsOn('permissions')
    expect(ran).toEqual([{ do: 'editTarget' }])
    expect(takeOpeningPage()).toBe('permissions')
    expect(takeOpeningPage(), 'the next open starts where it always does').toBeNull()
  })

  it('leaves no page behind when Settings does not open', async () => {
    outcome = { ok: false, refusal: { kind: 'stale', message: 'No.' } }
    openSettingsOn('permissions')
    await new Promise(resolve => setImmediate(resolve))
    expect(takeOpeningPage()).toBeNull()
  })
})

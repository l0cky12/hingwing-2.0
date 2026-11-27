import type { PromptId } from '@highwing/hermes/domain'
import type { ThreadNode } from '@highwing/thread'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Node, type AskAgain } from '../src/renderer/chat/Thread'
import { NONE_OPEN } from '../src/renderer/chat/open'

const question = (busy: boolean): ThreadNode => ({
  kind: 'prompt', key: 't1/3',
  card: {
    state: 'asking', promptId: 'p1' as PromptId, heading: 'Hermes has a question', command: null, why: 'Where should it go?',
    pick: { kind: 'many', choices: ['staging', 'production'] }, tell: false, busy, error: null, left: null
  }
})

const markup = (node: ThreadNode) =>
  renderToStaticMarkup(<Node node={node} endTone="asking" elapsed={null} open={NONE_OPEN} onToggle={() => {}} onAnswer={async () => undefined} onAskAgain={async () => false} helpers={null} />)

describe('a question that takes several answers', () => {
  it('is a group named by its heading, with a checkbox per choice and one for Other', () => {
    const html = markup(question(false))
    expect(html).toContain('role="group" aria-label="Hermes has a question"')
    expect(html).toContain('<legend>Pick all that apply</legend>')
    expect(html.match(/type="checkbox"/g)).toHaveLength(3)
    expect(html).toMatch(/<input type="checkbox"\/>Other<\/label>/)
  })

  it('has nothing to send until a box is checked, and can always be skipped', () => {
    const html = markup(question(false))
    expect(html).toMatch(/<button class="primary" disabled="">Answer<\/button>/)
    expect(html).toMatch(/<button type="button" class="deny">Skip<\/button>/)
  })

  it('disables every box and button while the chat is not live', () => {
    expect(markup(question(true))).toContain('<fieldset class="picks" disabled="">')
  })
})

describe('an approval with a time limit', () => {
  const asking: ThreadNode = {
    kind: 'prompt', key: 't1/4',
    card: {
      state: 'asking', promptId: 'p1' as PromptId, heading: 'Run this command?', command: 'rm -rf scratch', why: null, tell: false, busy: false, error: null, left: '4 min left',
      pick: { kind: 'one', freeText: false, buttons: [{ reply: { kind: 'choice', value: 'once' }, label: 'Run once', role: 'primary', confirm: null }] }
    }
  }
  const expired: ThreadNode = {
    kind: 'prompt', key: 't1/4',
    card: { state: 'expired', heading: 'Approval expired', command: 'rm -rf scratch', words: 'Nobody answered in time, so Hermes did not run it.', askAgain: 'Please ask me again.' }
  }
  const drawn = (node: ThreadNode, onAskAgain: AskAgain) =>
    renderToStaticMarkup(<Node node={node} endTone={null} elapsed={null} open={NONE_OPEN} onToggle={() => {}} onAnswer={async () => undefined} onAskAgain={onAskAgain} helpers={null} />)

  it('shows the time left outside the status line, which stays empty while it asks, so a tick is never read out', () => {
    const html = markup(asking)
    expect(html).toContain('<p class="why left">4 min left</p>')
    expect(html).toContain('<p class="why" role="status"></p>')
  })

  it('puts the expiry in the status line and offers Ask again in place of the answers', () => {
    const html = drawn(expired, async () => true)
    expect(html).toContain('<p class="why" role="status" data-find="t1/4 words">Nobody answered in time, so Hermes did not run it.</p>')
    expect(html).toContain('<button type="button" class="primary">Ask again</button>')
    expect(html).not.toContain('Run once')
  })

  it('cannot ask again while the chat is not live', () => {
    expect(drawn(expired, null)).toContain('<button type="button" class="primary" disabled="">Ask again</button>')
  })
})

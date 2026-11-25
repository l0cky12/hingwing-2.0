import type { PromptId } from '@highwing/hermes/domain'
import type { ThreadNode } from '@highwing/thread'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Node } from '../src/renderer/chat/Thread'
import { NONE_OPEN } from '../src/renderer/chat/open'

const question = (busy: boolean): ThreadNode => ({
  kind: 'prompt', key: 't1/3',
  card: {
    state: 'asking', promptId: 'p1' as PromptId, heading: 'Hermes has a question', command: null, why: 'Where should it go?',
    pick: { kind: 'many', choices: ['staging', 'production'] }, tell: false, busy, error: null
  }
})

const markup = (node: ThreadNode) =>
  renderToStaticMarkup(<Node node={node} endTone="asking" elapsed={null} open={NONE_OPEN} onToggle={() => {}} onAnswer={async () => undefined} helpers={null} />)

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

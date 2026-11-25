import type { PromptId } from '@highwing/hermes/domain'
import type { PromptCard, ThreadNode } from '@highwing/thread'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NONE_OPEN } from '../src/renderer/chat/open'
import { Node } from '../src/renderer/chat/Thread'

const card = (more: Partial<Extract<PromptCard, { state: 'asking' }>>): ThreadNode => ({
  kind: 'prompt', key: 't1/4',
  card: {
    state: 'asking', promptId: 'p1' as PromptId, heading: 'Run this command?', command: 'rm -rf drafts', why: null, tell: true, busy: false, error: null,
    pick: {
      kind: 'one', freeText: false,
      buttons: [{ reply: { kind: 'choice', value: 'once' }, label: 'Run once', role: 'primary', confirm: null }, { reply: { kind: 'choice', value: 'deny' }, label: "Don't run", role: 'decline', confirm: null }]
    },
    ...more
  }
})
const draw = (node: ThreadNode) => renderToStaticMarkup(<Node node={node} endTone="asking" elapsed={null} open={NONE_OPEN} onToggle={() => {}} onAnswer={async () => undefined} />)
const buttons = (markup: string) => Array.from(markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g), ([, attributes = '', name = '']) => `${name.replace(/&#x27;/g, "'")}${attributes.includes('disabled') ? ' (disabled)' : ''}`)

describe('telling Hermes what to do instead of running a command', () => {
  it('is offered under the choices of an approval that can be denied, with its field closed', () => {
    const markup = draw(card({}))
    const named = buttons(markup)
    expect(named.indexOf('Tell Hermes what to do instead')).toBeGreaterThan(named.indexOf("Don't run"))
    expect(named.indexOf("Don't run")).toBeGreaterThan(-1)
    expect(markup).not.toContain('What Hermes should do instead')
  })

  it('is not offered on a card that cannot be denied', () => {
    expect(buttons(draw(card({ tell: false })))).not.toContain('Tell Hermes what to do instead')
  })

  it('is disabled while an answer is on its way or the chat is not live', () => {
    expect(buttons(draw(card({ busy: true })))).toContain('Tell Hermes what to do instead (disabled)')
  })
})

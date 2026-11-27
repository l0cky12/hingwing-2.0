import type { TurnView } from '@highwing/thread'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { NONE_OPEN } from '../src/renderer/chat/open'
import { Turn } from '../src/renderer/chat/Thread'

const turn = (handed: boolean): TurnView => ({ key: 't1', time: null, request: 'Draft the weekly report', handed, attachments: [], rowId: 3, tokens: null, reactions: null, pages: [], nodes: [], end: { kind: 'done', words: 'Done' } })
const draw = (handed: boolean) => renderToStaticMarkup(
  <Turn
    turn={turn(handed)} open={NONE_OPEN} onToggle={() => {}} onAnswer={async () => undefined} onAskAgain={async () => false} canEdit showsRegenerate={false} canRegenerate={false} canBranch
    onEdit={() => {}} onRegenerate={() => {}} onBranch={() => {}} onNewChat={() => {}} versions={[]} onVersion={() => {}} canReact onReact={() => {}} helpers={null}
  />
)

describe('a message handed to the bot', () => {
  it('names its turn "Handed over" and shows the words above the request', () => {
    const markup = draw(true)
    expect(markup).toMatch(/<article [^>]*aria-label="Handed over"/)
    expect(markup).toContain('<p class="handed-from" aria-hidden="true">Handed over</p>')
    expect(markup.indexOf('Handed over')).toBeLessThan(markup.indexOf('Draft the weekly report'))
  })

  it('leaves a message the user typed as it was', () => {
    const markup = draw(false)
    expect(markup).not.toContain('Handed over')
    expect(markup).not.toContain('aria-label="Handed over"')
  })
})

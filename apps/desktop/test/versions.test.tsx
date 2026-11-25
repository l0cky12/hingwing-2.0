import type { SessionId, Version, Versions } from '@highwing/hermes/domain'
import type { TurnView } from '@highwing/thread'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { forget, landAt, landed, landingFor, pressFor } from '../src/renderer/chat/landing'
import { NONE_OPEN } from '../src/renderer/chat/open'
import { Turn, VersionSwitch } from '../src/renderer/chat/Thread'

type Props = Parameters<typeof Turn>[0]

const [FIRST, SECOND, THIRD] = ['s1', 's2', 's3'] as SessionId[] as [SessionId, SessionId, SessionId]
const TRIES: readonly Version[] = [{ sessionId: FIRST, landing: 3 }, { sessionId: SECOND, landing: 3 }, { sessionId: THIRD, landing: 'end' }]
const at = (current: number): Versions => ({ versions: TRIES, current })
const turn: TurnView = { key: 't1', time: null, request: 'Group them by month', attachments: [], rowId: 3, tokens: null, nodes: [], end: { kind: 'done', words: 'Done' } }
const props = (more: Partial<Props>): Props => ({
  turn, open: NONE_OPEN, onToggle: () => {}, onAnswer: async () => undefined, canEdit: true, showsRegenerate: false, canRegenerate: false,
  canBranch: true, onEdit: () => {}, onRegenerate: () => {}, onBranch: () => {}, versions: [at(1)], onVersion: () => {}, ...more
})
const draw = (more: Partial<Props>) => renderToStaticMarkup(<Turn {...props(more)} />)

function pressed(node: ReactNode, name: string): void {
  if (Array.isArray(node)) return node.forEach(child => pressed(child, name))
  if (!isValidElement(node)) return
  const { type, props: held } = node as ReactElement<{ children?: ReactNode; 'aria-label'?: string; onClick?: () => void }>
  if (type === 'button' && held['aria-label'] === name) held.onClick?.()
  pressed(held.children, name)
}

describe('the version switcher', () => {
  it('sits on a message that has versions, before its actions, and reads which one is shown', () => {
    const markup = draw({})
    expect(markup).toMatch(/<span class="versions" role="group" aria-label="Versions">.*2 \/ 3.*<\/span>/)
    expect(markup.indexOf('aria-label="Next version"')).toBeLessThan(markup.indexOf('aria-label="Copy request"'))
    expect(markup).toMatch(/<button[^>]*aria-label="Previous version"(?![^>]*disabled)[^>]*>/)
    expect(markup).toMatch(/<button[^>]*aria-label="Next version"(?![^>]*disabled)[^>]*>/)
  })

  it('is not there for a message with one try', () => {
    expect(draw({ versions: [] })).not.toContain('Versions')
  })

  it('has no Previous on the first version and no Next on the last', () => {
    expect(draw({ versions: [at(0)] })).toMatch(/<button[^>]*aria-label="Previous version"[^>]*disabled/)
    expect(draw({ versions: [at(0)] })).toContain('1 / 3')
    expect(draw({ versions: [at(2)] })).toMatch(/<button[^>]*aria-label="Next version"[^>]*disabled/)
  })

  it('shows both families of a chat that is a branch and was branched again at the same message', () => {
    const own: Versions = { versions: [{ sessionId: SECOND, landing: 3 }, { sessionId: 's4' as SessionId, landing: 3 }], current: 0 }
    const markup = draw({ versions: [at(1), own] })
    expect(markup.match(/role="group" aria-label="Versions"/g)).toHaveLength(2)
    expect(markup.indexOf('2 / 3')).toBeLessThan(markup.indexOf('1 / 2'))
  })

  it('asks for the version beside the shown one, with where its message sits', () => {
    const asked: Version[] = []
    const rendered = VersionSwitch({ versions: at(1), onVersion: version => asked.push(version) })
    pressed(rendered, 'Next version')
    pressed(rendered, 'Previous version')
    expect(asked).toEqual([{ sessionId: THIRD, landing: 'end' }, { sessionId: FIRST, landing: 3 }])
  })
})

describe('the landing a press asks for', () => {
  it('is held for the chat it opens, until that chat lands or another press replaces it', () => {
    landAt({ sessionId: SECOND, landing: 3 })
    expect(landingFor(FIRST)).toBeNull()
    expect(landingFor(SECOND)).toBe(3)
    landed(FIRST)
    expect(landingFor(SECOND), 'the chat left behind does not clear it').toBe(3)
    landed(SECOND)
    expect(landingFor(SECOND)).toBeNull()
    landAt({ sessionId: SECOND, landing: 3 })
    landAt({ sessionId: THIRD, landing: 'end' })
    expect([landingFor(SECOND), landingFor(THIRD)]).toEqual([null, 'end'])
  })

  it('is not cleared by a late answer to an earlier press of the same chat', () => {
    landAt({ sessionId: SECOND, landing: 3 })
    const earlier = pressFor(SECOND)
    landAt({ sessionId: SECOND, landing: 3 })
    if (earlier !== null) forget(earlier)
    expect(landingFor(SECOND)).toBe(3)
    const current = pressFor(SECOND)
    if (current !== null) forget(current)
    expect(landingFor(SECOND)).toBeNull()
  })
})

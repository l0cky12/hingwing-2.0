import type { AdmissionId, QueuedAction } from '@highwing/hermes/domain'
import type { PendingRow } from '@highwing/thread'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { marked, pressedOf, unmarked, type MarkEvent } from '../src/renderer/chat/marks'
import { Pending, type QueueControls, type QueuedRow } from '../src/renderer/chat/Thread'

const row = (more: Partial<QueuedRow>): QueuedRow =>
  ({ status: 'queued', key: 'input-1', text: 'Also update the changelog.', attachments: [], admissionId: 'adm-1' as AdmissionId, from: 'here', actions: ['sendNow', 'edit', 'cancel'], ...more }) as QueuedRow
const controls = (more: Partial<QueueControls> = {}): QueueControls => ({ canAct: true, pressed: new Map(), onAct: () => {}, ...more })
const draw = (pending: PendingRow, more?: Partial<QueueControls>) => renderToStaticMarkup(<Pending row={pending} queue={controls(more)} />)
const buttons = (markup: string) => Array.from(markup.matchAll(/<button([^>]*)>([^<]*)<\/button>/g), ([, attributes, name]) => `${name}${attributes?.includes('disabled') ? ' (disabled)' : ''}`)
const words = (markup: string) => Array.from(markup.matchAll(/<p class="notice">([^<]*)<\/p>/g), ([, text]) => text)

function press(node: ReactNode, name: string): void {
  if (Array.isArray(node)) return node.forEach(child => press(child, name))
  if (!isValidElement(node)) return
  const { type, props } = node as ReactElement<{ children?: ReactNode; onClick?: () => void; row?: QueuedRow; queue?: QueueControls }>
  if (typeof type === 'function') return press((type as (props: object) => ReactNode)(props), name)
  if (type === 'button' && props.children === name) props.onClick?.()
  press(props.children, name)
}

describe('a queued row', () => {
  it('says it is queued and offers Send now, Edit and Cancel in that order', () => {
    const markup = draw(row({}))
    expect(words(markup)).toEqual(['Queued'])
    expect(buttons(markup)).toEqual(['Send now', 'Edit', 'Cancel'])
  })

  it('says when another app queued it, and offers only what Hermes allows', () => {
    const markup = draw(row({ from: 'elsewhere', actions: ['cancel'] }))
    expect(words(markup)).toEqual(['Queued', 'From another app'])
    expect(buttons(markup)).toEqual(['Cancel'])
  })

  it('says a row on its way into the turn is, and offers nothing', () => {
    const markup = draw(row({ status: 'steering', actions: [] }))
    expect(words(markup)).toEqual(['On its way into this turn'])
    expect(buttons(markup)).toEqual([])
  })

  it('explains a lost row and offers to discard it, without naming the app that sent it', () => {
    const markup = draw(row({ status: 'lost', from: 'elsewhere', actions: ['release'] }))
    expect(words(markup)).toEqual(["Hermes restarted during this message and can&#x27;t finish it. Messages behind it wait until you discard it."])
    expect(buttons(markup)).toEqual(['Discard'])
  })

  it('keeps every button of a pressed row disabled, the pressed one saying what it does, until Hermes lists the row differently', () => {
    const pressed = new Map<AdmissionId, QueuedAction>([['adm-1' as AdmissionId, 'cancel']])
    expect(buttons(draw(row({}), { pressed }))).toEqual(['Send now (disabled)', 'Edit (disabled)', 'Cancelling… (disabled)'])
    expect(buttons(draw(row({ actions: ['sendNow'] }), { pressed: new Map([['adm-1' as AdmissionId, 'sendNow']]) }))).toEqual(['Sending… (disabled)'])
    expect(buttons(draw(row({ status: 'lost', actions: ['release'] }), { pressed: new Map([['adm-1' as AdmissionId, 'release']]) }))).toEqual(['Discarding… (disabled)'])
  })

  it('disables its buttons while the chat is not live', () => {
    expect(buttons(draw(row({}), { canAct: false }))).toEqual(['Send now (disabled)', 'Edit (disabled)', 'Cancel (disabled)'])
  })

  it('hands the pressed action and the row to the chat', () => {
    const acted: [string, QueuedAction][] = []
    const listed = row({})
    press(<Pending row={listed} queue={controls({ onAct: (pressedRow, action) => acted.push([pressedRow.text, action]) })} />, 'Send now')
    expect(acted).toEqual([['Also update the changelog.', 'sendNow']])
  })
})

describe('a press on a queued row', () => {
  const queued = row({})
  const listing = (...rows: QueuedRow[]): MarkEvent => ({ kind: 'listed', listed: new Map(rows.map(listed => [listed.admissionId, listed])) })
  const after = (...events: MarkEvent[]) => pressedOf(events.reduce(marked, unmarked(new Map([[queued.admissionId, queued]]))))

  it('holds while Hermes lists the row unchanged', () => {
    expect(after({ kind: 'pressed', row: queued, action: 'sendNow' }, listing(queued))).toEqual(new Map([[queued.admissionId, 'sendNow']]))
  })

  it('ends for good once Hermes lists the row differently, even when the row later reads as it did', () => {
    const steering = row({ status: 'steering', actions: [] })
    expect(after({ kind: 'pressed', row: queued, action: 'sendNow' }, listing(steering), listing(queued))).toEqual(new Map())
  })

  it('ends for good once Hermes stops listing the row, even when the row comes back', () => {
    expect(after({ kind: 'pressed', row: queued, action: 'cancel' }, listing(), listing(queued))).toEqual(new Map())
  })

  it('ends when Hermes refuses it', () => {
    expect(after({ kind: 'pressed', row: queued, action: 'cancel' }, { kind: 'refused', row: queued })).toEqual(new Map())
  })
})

describe('a message Hermes has not listed', () => {
  it('reads Sending with no buttons, and a refused one shows why', () => {
    expect(words(draw({ status: 'sending', key: 'k', text: 'Hi', attachments: [] }))).toEqual(['Sending'])
    expect(buttons(draw({ status: 'sending', key: 'k', text: 'Hi', attachments: [] }))).toEqual([])
    expect(draw({ status: 'failed', key: 'k', text: 'Hi', attachments: [], detail: 'Hermes refused it.' })).toMatch(/<p class="err"[^>]*>Hermes refused it\.<\/p>/)
  })
})

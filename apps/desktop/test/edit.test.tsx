import type { AdmissionId } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { QueuedRow } from '../src/renderer/chat/Thread'
import { editingOf, removalWords, type EditTarget } from '../src/renderer/composer/edit'
import { RemoveDialog } from '../src/renderer/composer/RemoveDialog'

describe('the removal sentence', () => {
  it.each([[1, 'This removes 1 later message.'], [2, 'This removes 2 later messages.'], [3, 'This removes 3 later messages.']])('counts %i later', (later, words) => {
    expect(removalWords(later)).toBe(words)
  })
})

describe('the removal dialog', () => {
  const markup = renderToStaticMarkup(<RemoveDialog later={3} onCancel={() => {}} onConfirm={() => {}} />)

  it('is named by the count and described by what cannot be undone', () => {
    const [, title] = /aria-labelledby="([^"]+)"/.exec(markup)!
    const [, detail] = /aria-describedby="([^"]+)"/.exec(markup)!
    expect(markup).toContain(`<p id="${title}" class="remove-count">This removes 3 later messages.</p>`)
    expect(markup).toContain(`<p id="${detail}">Hermes can’t bring them back.</p>`)
  })

  it('offers Cancel and Remove and send', () => {
    expect(Array.from(markup.matchAll(/<button[^>]*>([^<]*)<\/button>/g), ([, name]) => name)).toEqual(['Cancel', 'Remove and send'])
  })
})

describe('an edit whose message moved on', () => {
  const admissionId = 'adm-1' as AdmissionId
  const queuedTarget: EditTarget = { kind: 'queued', press: 1, admissionId, text: 'Also update the changelog.' }
  const listed = (more: Partial<QueuedRow>) => new Map([[admissionId, { status: 'queued', key: 'input-1', text: 'Also update the changelog.', admissionId, from: 'here', actions: ['sendNow', 'edit', 'cancel'], ...more } as QueuedRow]])
  const gone = (why: string) => ({ kind: 'gone', press: 1, text: 'Also update the changelog.', why })

  it('stays a queued edit while Hermes lets the row be edited', () => {
    expect(editingOf(queuedTarget, [], listed({}))).toEqual({ kind: 'queued', press: 1, admissionId, text: 'Also update the changelog.' })
  })

  it('stays an edit, saying why it cannot be sent, once the queued row starts', () => {
    expect(editingOf(queuedTarget, [], listed({ status: 'steering', actions: [] }))).toEqual(gone("That message has already started, so it can't be edited."))
  })

  it('stays an edit, saying why it cannot be sent, once the queued row leaves the queue', () => {
    expect(editingOf(queuedTarget, [], new Map())).toEqual(gone('That message is no longer queued.'))
  })

  it('stays an edit, saying why it cannot be sent, once Hermes stops offering Edit', () => {
    expect(editingOf(queuedTarget, [], listed({ actions: ['cancel'] }))).toEqual(gone('Hermes no longer lets you edit that message.'))
  })

  it('stays an edit, saying why it cannot be sent, once the sent message leaves the chat', () => {
    const sentTarget: EditTarget = { kind: 'sent', press: 1, rowId: 7, text: 'Also update the changelog.' }
    expect(editingOf(sentTarget, [{ rowId: 7 }, { rowId: 9 }], new Map())).toEqual({ kind: 'sent', press: 1, rowId: 7, later: 1, text: 'Also update the changelog.' })
    expect(editingOf(sentTarget, [{ rowId: 9 }], new Map())).toEqual(gone('That message is no longer in this chat.'))
  })
})

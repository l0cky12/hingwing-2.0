import { beforeAll, describe, expect, it } from 'vitest'
import type { Bridge, Draft, DraftKey, Quote } from '../src/ipc-contract'

const saved: Draft[] = []
beforeAll(() => {
  Object.assign(globalThis, { window: { addEventListener: () => {}, highwing: { keepDraft: (draft: Draft) => void saved.push(draft), drafts: async () => [] } satisfies Partial<Bridge> } })
})

const drafts = () => import('../src/renderer/composer/drafts')
const slot = (key: string) => ({ key: key as DraftKey, bot: null })
const lastIn = (key: string) => saved.filter(draft => draft.key === key).at(-1)
const NOTES: Quote = { from: 'hermes', text: 'Both are notes.' }
const ASKED: Quote = { from: 'you', text: 'List the folder' }

describe('a draft that replies to a message', () => {
  it('keeps its quote in its own chat while another chat is typed in, and saves it at once', async () => {
    const { quoteInto, writeDraft } = await drafts()
    quoteInto(slot('chat:q1'), NOTES)
    expect(lastIn('chat:q1')).toEqual({ key: 'chat:q1', bot: null, text: '', attachments: [], quote: NOTES })
    writeDraft(slot('chat:q2'), 'something else')
    quoteInto(slot('chat:q2'), ASKED)
    expect(lastIn('chat:q1')?.quote).toEqual(NOTES)
  })

  it('clears the quote it sent, and keeps one put there while the message was on its way', async () => {
    const { draftSent, quoteInto, writeDraft } = await drafts()
    const chat = slot('chat:q3')
    writeDraft(chat, 'Which is newer?')
    quoteInto(chat, NOTES)
    draftSent(chat, 'Which is newer?', new Set(), NOTES)
    expect(lastIn('chat:q3')).toEqual({ key: 'chat:q3', bot: null, text: '', attachments: [], quote: null })
    quoteInto(chat, ASKED)
    draftSent(chat, 'Only the notes.', new Set(), NOTES)
    expect(lastIn('chat:q3')?.quote).toEqual(ASKED)
    draftSent(chat, '/usage', new Set(), null)
    expect(lastIn('chat:q3')?.quote, 'a message sent without the quote leaves it').toEqual(ASKED)
  })

  it('takes its quote along to the chat its refused first message made', async () => {
    const { moveDraft, quoteInto, writeDraft } = await drafts()
    const [fresh, made] = [slot('bot:emu'), slot('chat:q4')]
    writeDraft(fresh, 'Which is newer?')
    quoteInto(fresh, NOTES)
    moveDraft(fresh, made)
    expect(lastIn('chat:q4')).toEqual({ key: 'chat:q4', bot: null, text: 'Which is newer?', attachments: [], quote: NOTES })
    expect(lastIn('bot:emu')).toEqual({ key: 'bot:emu', bot: null, text: '', attachments: [], quote: null })
  })

  it('moves when it holds only a quote, and never over a chat that holds one', async () => {
    const { moveDraft, quoteInto } = await drafts()
    const [from, to, empty] = [slot('chat:q5'), slot('chat:q6'), slot('chat:q7')]
    quoteInto(to, ASKED)
    quoteInto(from, NOTES)
    moveDraft(from, to)
    expect(lastIn('chat:q6')?.quote).toEqual(ASKED)
    moveDraft(from, empty)
    expect(lastIn('chat:q7')?.quote).toEqual(NOTES)
    expect(lastIn('chat:q5')?.quote).toBeNull()
  })

  it("splits a carried reply into the new chat's quote and text", async () => {
    const { carryToNewChat } = await drafts()
    carryToNewChat(null, '[Replying to your previous message: "Both are notes."]\n\nWhich is newer?')
    expect(lastIn('new')).toEqual({ key: 'new', bot: null, text: 'Which is newer?', attachments: [], quote: NOTES })
  })
})

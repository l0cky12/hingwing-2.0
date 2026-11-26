import type { Attachment, AttachmentId, BotId, GroupId } from '@highwing/hermes/domain'
import { beforeAll, describe, expect, it } from 'vitest'
import { MAX_ATTACHMENTS, parseDraft, type Bridge, type Draft, type DraftKey, type StageResult } from '../src/ipc-contract'
import { admitted } from '../src/renderer/composer/Composer'

const saved: Draft[] = []
beforeAll(() => {
  Object.assign(globalThis, { window: { addEventListener: () => {}, highwing: { keepDraft: (draft: Draft) => void saved.push(draft), drafts: async () => [] } satisfies Partial<Bridge> } })
})

const drafts = () => import('../src/renderer/composer/drafts')
const attachment = (id: string, kind: Attachment['kind'] = 'image'): Attachment => ({ id: id as AttachmentId, name: `${id}.${kind === 'image' ? 'png' : 'pdf'}`, kind, size: 10 })
const slot = (key: string) => ({ key: key as DraftKey, bot: null })
const last = () => saved.at(-1)

describe('the place to type in a group chat', () => {
  it('is keyed by the group, with no bot of its own', async () => {
    const { slotOf } = await drafts()
    expect(slotOf({ kind: 'group', group: 'launch-plan' as GroupId, over: 'sam' as BotId })).toEqual({ key: 'group:launch-plan', bot: null })
  })
})

describe('a draft with attachments', () => {
  it('saves each attachment change at once, in the order the chips show', async () => {
    const { attachTo, detach, moveAttachment } = await drafts()
    const chat = slot('chat:s1')
    const [a, b, c] = [attachment('a'), attachment('b'), attachment('c', 'file')]
    attachTo(chat, [a, b])
    attachTo(chat, [c])
    expect(last()).toEqual({ key: 'chat:s1', bot: null, text: '', attachments: [a, b, c] })
    moveAttachment(chat, c.id, -1)
    expect(last()?.attachments).toEqual([a, c, b])
    moveAttachment(chat, a.id, -1)
    expect(last()?.attachments, 'nothing moves past the start').toEqual([a, c, b])
    detach(chat, c.id)
    expect(last()?.attachments).toEqual([a, b])
  })

  it('clears the text and exactly the attachments sent, and keeps one added while the message was on its way', async () => {
    const { attachTo, draftSent, writeDraft } = await drafts()
    const chat = slot('chat:s2')
    const [sent, later] = [attachment('sent'), attachment('later')]
    writeDraft(chat, 'what is this')
    attachTo(chat, [sent, later])
    draftSent(chat, 'what is this', new Set([sent.id]))
    expect(last()).toEqual({ key: 'chat:s2', bot: null, text: '', attachments: [later] })
  })

  it('moves a draft to the chat its refused first message made, and never over a draft that chat holds', async () => {
    const { attachTo, moveDraft, writeDraft } = await drafts()
    const [fresh, made] = [slot('new'), slot('chat:s5')]
    const shot = attachment('shot')
    writeDraft(fresh, 'what is this')
    attachTo(fresh, [shot])
    moveDraft(fresh, made)
    expect(saved.filter(draft => draft.key === made.key).at(-1)).toEqual({ key: 'chat:s5', bot: null, text: 'what is this', attachments: [shot] })
    expect(saved.filter(draft => draft.key === fresh.key).at(-1)).toEqual({ key: 'new', bot: null, text: '', attachments: [] })
    attachTo(fresh, [attachment('other')])
    moveDraft(fresh, made)
    expect(saved.filter(draft => draft.key === made.key).at(-1)?.attachments, 'the chat keeps its own').toEqual([shot])
  })

  it('counts the files still staging into each draft, whichever composer started them', async () => {
    const { stagingFor, stagingIn } = await drafts()
    const [a, b] = [slot('chat:s7'), slot('chat:s8')]
    const finish: { done?: (results: readonly StageResult[]) => void } = {}
    const pending = stagingFor(a, new Promise<readonly StageResult[]>(resolve => (finish.done = resolve)))
    expect([stagingIn(a), stagingIn(b)]).toEqual([1, 0])
    finish.done?.([])
    await pending
    expect(stagingIn(a)).toBe(0)
  })

  it('keeps the attachments of one chat out of another', async () => {
    const { attachTo } = await drafts()
    attachTo(slot('chat:s3'), [attachment('mine')])
    attachTo(slot('chat:s4'), [attachment('theirs')])
    expect(saved.filter(draft => draft.key === slot('chat:s4').key).at(-1)?.attachments).toEqual([attachment('theirs')])
  })
})

describe('what a batch of staged files adds', () => {
  const ok = (held: Attachment): StageResult => ({ ok: true, attachment: held })

  it('adds the files that were held and words each one refused, keeping the rest', () => {
    const results: StageResult[] = [ok(attachment('a')), { ok: false, name: 'big.png', reason: 'big.png is 31 MB. Hermes takes images up to 25 MB.' }, ok(attachment('b', 'file'))]
    expect(admitted(results, [])).toEqual({ added: [attachment('a'), attachment('b', 'file')], refused: ['big.png is 31 MB. Hermes takes images up to 25 MB.'] })
  })

  it('stops at ten images a message, counting the ones already attached, and still takes files', () => {
    const held = Array.from({ length: 9 }, (_, index) => attachment(`held-${index}`))
    const { added, refused } = admitted([ok(attachment('tenth')), ok(attachment('eleventh')), ok(attachment('notes', 'file'))], held)
    expect(added.map(item => item.id)).toEqual(['tenth', 'notes'])
    expect(refused).toEqual(["Hermes takes up to 10 images in one message, so eleventh.png wasn't attached."])
  })

  it('stops at the most attachments a message can carry, so the draft and the send stay valid', () => {
    const held = Array.from({ length: MAX_ATTACHMENTS - 1 }, (_, index) => attachment(`held-${index}`, 'file'))
    const { added, refused } = admitted([ok(attachment('last', 'file')), ok(attachment('over', 'file'))], held)
    expect(added.map(item => item.id)).toEqual(['last'])
    expect(refused).toEqual([`A message holds up to ${MAX_ATTACHMENTS} attachments, so over.pdf wasn't attached.`])
    expect(parseDraft({ key: 'chat:s6', bot: null, text: '', attachments: [...held, ...added] })).not.toBeNull()
  })
})

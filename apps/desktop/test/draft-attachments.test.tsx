import type { Attachment, AttachmentId } from '@highwing/hermes/domain'
import { beforeAll, describe, expect, it } from 'vitest'
import type { Bridge, Draft, DraftKey, StageResult } from '../src/ipc-contract'
import { admitted } from '../src/renderer/composer/Composer'

const saved: Draft[] = []
beforeAll(() => {
  Object.assign(globalThis, { window: { addEventListener: () => {}, highwing: { keepDraft: (draft: Draft) => void saved.push(draft), drafts: async () => [] } satisfies Partial<Bridge> } })
})

const drafts = () => import('../src/renderer/composer/drafts')
const attachment = (id: string, kind: Attachment['kind'] = 'image'): Attachment => ({ id: id as AttachmentId, name: `${id}.${kind === 'image' ? 'png' : 'pdf'}`, kind, size: 10 })
const slot = (key: string) => ({ key: key as DraftKey, bot: null })
const last = () => saved.at(-1)

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
})

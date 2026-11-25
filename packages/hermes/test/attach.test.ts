import { describe, expect, it } from 'vitest'
import type { AttachmentId, SettledTurn } from '../src/domain/session'
import { openHermes, type Upload } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { play, scriptedDialer, type Fixture, type Moment } from '../src/testing/fixture'
import { callsIn, ERRAND, paramsOf, SESSION, SLASH } from './support/errand'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
const PDF = new TextEncoder().encode('%PDF-1.7\n%fake contract\n')
const TEXT = String(paramsOf('prompt.submit').text)

const upload = (id: string, name: string, kind: Upload['kind'], mime: string, bytes: Uint8Array): Upload =>
  ({ id: id as AttachmentId, name, kind, size: bytes.byteLength, mime, bytes })
const ERROR_PNG = upload('a-1', 'error.png', 'image', 'image/png', PNG)
const CONTRACT = upload('a-2', 'contract.pdf', 'file', 'application/pdf', PDF)

function open(fixture: Fixture, held: readonly Upload[]) {
  const clock = manualClock()
  const script = scriptedDialer(fixture, { clock })
  const hermes = openHermes({
    dial: script, clock, client: { name: 'highwing-test', version: '0' },
    uploads: { read: async id => held.find(found => found.id === id) ?? null }
  })
  const sent = () => callsIn(script.received).filter(call => call.method !== 'session.stats')
  return { clock, script, hermes, sent, watch: () => hermes.watch(fixture.header.sessionId, () => {}) }
}

describe('a message with an image, played through the real client', () => {
  it('stages the image before the submit, names the staged path in it, and settles a request that holds the image', async () => {
    const seen: Moment[] = []
    for await (const moment of play(ERRAND, { attach: [ERROR_PNG] })) seen.push(moment)
    const { script, session } = seen.at(-1) as Moment
    const calls = callsIn(script.received)
    const methods = calls.map(call => call.method)
    expect(methods.indexOf('image.attach_bytes')).toBeGreaterThan(-1)
    expect(methods.indexOf('image.attach_bytes')).toBeLessThan(methods.indexOf('prompt.submit'))
    const staged = calls.find(call => call.method === 'image.attach_bytes')
    expect(staged?.params).toEqual({ session_id: SESSION, content_base64: Buffer.from(PNG).toString('base64'), ext: 'png' })
    const submit = calls.find(call => call.method === 'prompt.submit')
    expect(submit?.params?.attachments).toEqual([{ path: '/hermes/default/cache/images/upload-1.png', mime: 'image/png' }])
    expect(submit?.params?.text).toBe(TEXT)
    const turn = session.history.at(-1) as SettledTurn
    expect(turn.request?.attachments).toEqual([{ id: 'a-1', name: 'error.png', kind: 'image', size: PNG.byteLength }])
  })
})

describe('sending with attachments', () => {
  it('attaches a file by its reference: the model reads it after the words, and the thread keeps the words alone', async () => {
    const opened = open(ERRAND, [CONTRACT])
    opened.watch()
    await opened.clock.advance(0)
    const outcome = opened.hermes.run({ do: 'send', sessionId: SESSION, text: TEXT, attachments: [CONTRACT.id] })
    await opened.clock.advance(0)
    expect(await outcome).toEqual({ ok: true, value: null })
    const submit = opened.sent().find(call => call.method === 'prompt.submit')
    expect(submit?.params).toMatchObject({ text: TEXT, api_text: `${TEXT}\n\n@file:/hermes/default/attachments/contract.pdf` })
    expect(submit?.params).not.toHaveProperty('attachments')
    const attach = opened.sent().find(call => call.method === 'file.attach')
    expect(attach?.params).toEqual({ session_id: SESSION, name: 'contract.pdf', data_url: `data:application/pdf;base64,${Buffer.from(PDF).toString('base64')}` })
  })

  it('stages an image by the type its bytes show, whatever its name says', async () => {
    const renamed = upload('a-4', 'photo.heic', 'image', 'image/png', PNG)
    const opened = open(ERRAND, [renamed])
    opened.watch()
    await opened.clock.advance(0)
    const outcome = opened.hermes.run({ do: 'send', sessionId: SESSION, text: TEXT, attachments: [renamed.id] })
    await opened.clock.advance(0)
    expect(await outcome).toEqual({ ok: true, value: null })
    expect(opened.sent().find(call => call.method === 'prompt.submit')?.params?.attachments).toEqual([{ path: '/hermes/default/cache/images/upload-1.png', mime: 'image/png' }])
  })

  it('sends nothing when Hermes refuses an attachment, and says which one', async () => {
    const huge = new Uint8Array(25 * 1024 * 1024 + 1)
    huge.set(PNG)
    const tooBig = upload('a-3', 'error.png', 'image', 'image/png', huge)
    const opened = open(ERRAND, [CONTRACT, tooBig])
    opened.watch()
    await opened.clock.advance(0)
    const outcome = opened.hermes.run({ do: 'send', sessionId: SESSION, text: TEXT, attachments: [CONTRACT.id, tooBig.id] })
    await opened.clock.advance(0)
    expect(await outcome).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'Hermes refused error.png: Hermes did not accept the request.' } })
    expect(opened.sent().map(call => call.method)).toEqual(expect.arrayContaining(['file.attach', 'image.attach_bytes']))
    expect(opened.sent().map(call => call.method)).not.toContain('prompt.submit')
  })

  it('sends nothing, and calls nothing, for an attachment Highwing no longer holds', async () => {
    const opened = open(ERRAND, [])
    opened.watch()
    await opened.clock.advance(0)
    const before = opened.sent().length
    const outcome = opened.hermes.run({ do: 'send', sessionId: SESSION, text: TEXT, attachments: [ERROR_PNG.id] })
    await opened.clock.advance(0)
    expect(await outcome).toEqual({ ok: false, refusal: { kind: 'stale', message: 'An attachment is no longer available. Remove it and attach it again.' } })
    expect(opened.sent().slice(before)).toEqual([])
  })

  it('refuses a command line that carries attachments, before running it', async () => {
    const opened = open(SLASH, [ERROR_PNG])
    opened.watch()
    await opened.clock.advance(0)
    const before = opened.sent().length
    const outcome = opened.hermes.run({ do: 'send', sessionId: SLASH.header.sessionId, text: '/new', attachments: [ERROR_PNG.id] })
    await opened.clock.advance(0)
    expect(await outcome).toEqual({ ok: false, refusal: { kind: 'rejected', message: "A command can't carry attachments. Remove them, or send a message instead." } })
    expect(opened.sent().slice(before)).toEqual([])
  })
})

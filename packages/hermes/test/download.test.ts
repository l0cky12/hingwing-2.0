import { describe, expect, it } from 'vitest'
import type { FarFile } from '../src/domain/library'
import { downloadedOf, downloadPath, MOST_BYTES, type Answered } from '../src/wire/download'

const FILE = { bot: 'rae', sessionId: 'local-0301', path: '/home/rae/work/notes.md' } as FarFile
const CANT_SEND = { ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't send files to Highwing. Update Hermes, then try again." } }
const CANT_REACH = { ok: false, refusal: { kind: 'offline', message: "Highwing couldn't reach Hermes to get notes.md." } }
const ATTACHMENT = { 'content-disposition': 'attachment; filename="notes.md"' }

async function* chunks(...parts: readonly (string | Uint8Array)[]): AsyncIterable<Uint8Array> {
  for (const part of parts) yield typeof part === 'string' ? Buffer.from(part) : part
}

const answer = (status: number, body: AsyncIterable<Uint8Array> | null, headers: Readonly<Record<string, string>> = {}): Answered =>
  ({ status, header: name => headers[name] ?? null, body })
const refusal = (status: number, detail: string) => answer(status, chunks(JSON.stringify({ detail })), { 'content-type': 'application/json' })

describe('the download route', () => {
  it("asks for the file's path as the file's bot, in its chat", () => {
    const asked = new URL(downloadPath({ ...FILE, path: '/home/rae/a b&c.md' }), 'http://127.0.0.1')
    expect(asked.pathname).toBe('/api/fs/download')
    expect(Object.fromEntries(asked.searchParams)).toEqual({ path: '/home/rae/a b&c.md', profile: 'rae', session_id: 'local-0301' })
  })
})

describe("what Hermes's answer to a download means", () => {
  it('is the file, whole, when it comes as an attachment', async () => {
    expect(await downloadedOf(answer(200, chunks('# Notes', '\n'), { ...ATTACHMENT, 'content-length': '8' }), FILE)).toEqual({ ok: true, value: new TextEncoder().encode('# Notes\n') })
    expect(await downloadedOf(answer(200, chunks('x'), ATTACHMENT), FILE), 'with no length').toEqual({ ok: true, value: new TextEncoder().encode('x') })
    expect(await downloadedOf(answer(200, null, ATTACHMENT), FILE), 'an empty file').toEqual({ ok: true, value: new Uint8Array() })
  })

  it.each([
    ["FastAPI's own 404, a Hermes with no download route", refusal(404, 'Not Found'), CANT_SEND],
    ['a 405, a Hermes whose route takes no GET', answer(405, chunks('{"detail":"Method Not Allowed"}')), CANT_SEND],
    ["a 403 profile_scope_mismatch, a Hermes that took the ticket but not its profile", refusal(403, 'profile_scope_mismatch'), CANT_SEND],
    ['a 200 that is no attachment, a page some older listener serves for any path', answer(200, chunks('<!doctype html>'), { 'content-type': 'text/html' }), CANT_SEND],
    ['a file Hermes no longer has', refusal(404, 'File not found'), { ok: false, refusal: { kind: 'stale', message: "notes.md isn't there any more." } }],
    ['a chat the bot no longer has', refusal(404, 'Session not found'), { ok: false, refusal: { kind: 'stale', message: 'Hermes no longer has the chat that made notes.md.' } }],
    [
      'any other 404',
      refusal(404, 'The file is inside the agent sandbox, which Hermes cannot read here'),
      { ok: false, refusal: { kind: 'stale', message: "Hermes couldn't find notes.md. The file is inside the agent sandbox, which Hermes cannot read here." } }
    ],
    ['a 404 with no words', answer(404, chunks('Not here')), { ok: false, refusal: { kind: 'stale', message: "Hermes couldn't find notes.md." } }],
    [
      'a file Hermes keeps to itself',
      refusal(403, 'Access to sensitive files is not allowed'),
      { ok: false, refusal: { kind: 'rejected', message: "Hermes won't send notes.md. Access to sensitive files is not allowed." } }
    ],
    ['a live database', refusal(409, 'Refusing to download a live database'), { ok: false, refusal: { kind: 'conflict', message: "Hermes is using notes.md, so it can't send it now. Try again later." } }],
    ['a path that is no file', refusal(400, 'Path points to a directory'), { ok: false, refusal: { kind: 'rejected', message: "Hermes can't send notes.md. Path points to a directory." } }],
    ['a ticket Hermes would not take', refusal(401, 'Unauthorized'), CANT_REACH],
    ['a redirect', answer(302, null, { location: 'http://elsewhere/' }), CANT_REACH],
    ['a gateway that failed', refusal(502, 'Bad Gateway'), CANT_REACH]
  ])('says so for %s', async (_, answered, outcome) => {
    expect(await downloadedOf(answered, FILE)).toEqual(outcome)
  })

  it('takes a file up to 100 MB, and refuses a bigger one before or while it comes', async () => {
    const TOO_BIG = { ok: false, refusal: { kind: 'rejected', message: 'notes.md is over 100 MB. Highwing saves files up to 100 MB from Hermes.' } }
    let read = false
    const unread = (async function* () { read = true; yield new Uint8Array(1) })()
    expect(await downloadedOf(answer(200, unread, { ...ATTACHMENT, 'content-length': String(MOST_BYTES + 1) }), FILE)).toEqual(TOO_BIG)
    expect(read, 'a length over the limit is refused unread').toBe(false)
    const megabyte = new Uint8Array(1024 * 1024)
    const endless = (async function* () { for (;;) yield megabyte })()
    expect(await downloadedOf(answer(200, endless, ATTACHMENT), FILE)).toEqual(TOO_BIG)
  })

  it('keeps nothing of a file that stopped coming before it was whole', async () => {
    const CUT = { ok: false, refusal: { kind: 'offline', message: 'notes.md stopped coming before it was whole, so Highwing saved nothing.' } }
    expect(await downloadedOf(answer(200, chunks('# No'), { ...ATTACHMENT, 'content-length': '8' }), FILE), 'shorter than its length').toEqual(CUT)
    const broken = (async function* () { yield Buffer.from('# No'); throw new Error('aborted') })()
    expect(await downloadedOf(answer(200, broken, ATTACHMENT), FILE), 'a connection that broke').toEqual(CUT)
  })
})

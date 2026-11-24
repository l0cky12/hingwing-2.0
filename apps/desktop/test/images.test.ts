import type { Session } from '@highwing/hermes/domain'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseImageRequest } from '../src/ipc-contract'
import { fixtureImageDeps, imageLoader, readLocalFile, type ImageContext, type ImageDeps } from '../src/main/images'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])
const GIF = new TextEncoder().encode('GIF89a......')
const WEBP = new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 ')
const AVIF = new TextEncoder().encode('\0\0\0\x1cftypavif\0\0\0\0')
const MIF1_AVIF = new TextEncoder().encode('\0\0\0\x18ftypmif1\0\0\0\0mif1avif')
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
const CAP = 64
const UNDER_CAP = (head: Uint8Array) => Uint8Array.from({ length: CAP }, (_, at) => head[at] ?? 0)
const OVER_CAP = (head: Uint8Array) => Uint8Array.from({ length: CAP + 1 }, (_, at) => head[at] ?? 0)

const sessionWith = (image: string | null): Session => ({
  cwd: null,
  history: [{ items: [{ kind: 'tool', status: { s: 'done', diffs: [], image } }] }],
  run: { state: 'idle' }
}) as unknown as Session

const WEB = { kind: 'web', url: 'https://example.com/c.png' } as const
const LOCAL: ImageContext = { session: sessionWith('/tmp/shot.png'), local: true }
const toolRequest = (path = '/tmp/shot.png') => ({ kind: 'tool', sessionId: 's1', path }) as never

function deps(over: Partial<ImageDeps> = {}): ImageDeps {
  return {
    fetchWeb: async () => new Response(PNG),
    readLocal: async () => PNG,
    cap: CAP,
    timeoutMs: 1000,
    ...over
  }
}

const streamOf = (...chunks: Uint8Array[]) => new ReadableStream<Uint8Array>({
  start(controller) {
    for (const chunk of chunks) controller.enqueue(chunk)
    controller.close()
  }
})

describe('parseImageRequest', () => {
  it.each([
    ['an https url', { kind: 'web', url: 'https://example.com/c.png' }],
    ['an http url', { kind: 'web', url: 'http://example.com/c.png' }],
    ['an absolute path of a session', { kind: 'tool', sessionId: 's1', path: '/tmp/shot.png' }],
    ['a Windows path of a session', { kind: 'tool', sessionId: 's1', path: 'C:\\shots\\a.png' }]
  ])('keeps %s', (_, raw) => {
    expect(parseImageRequest(raw)).toEqual(raw)
  })

  it.each([
    ['a file url', { kind: 'web', url: 'file:///etc/passwd' }],
    ['a javascript url', { kind: 'web', url: 'javascript:alert(1)' }],
    ['a data url', { kind: 'web', url: 'data:image/png;base64,AAAA' }],
    ['a mailto url', { kind: 'web', url: 'mailto:a@example.com' }],
    ['a relative url', { kind: 'web', url: '/c.png' }],
    ['a web request with no url', { kind: 'web' }],
    ['a tool request with a relative path', { kind: 'tool', sessionId: 's1', path: 'shot.png' }],
    ['a tool request with no session', { kind: 'tool', path: '/tmp/shot.png' }],
    ['a tool request with a blank session', { kind: 'tool', sessionId: ' ', path: '/tmp/shot.png' }],
    ['a request of another kind', { kind: 'blob', url: 'https://example.com/c.png' }],
    ['a string', 'https://example.com/c.png'],
    ['null', null]
  ])('refuses %s', (_, raw) => {
    expect(parseImageRequest(raw)).toBeNull()
  })

  it('keeps only the known fields', () => {
    expect(parseImageRequest({ kind: 'web', url: 'https://example.com/c.png', extra: 1 })).toEqual({ kind: 'web', url: 'https://example.com/c.png' })
  })
})

describe('loading a web image', () => {
  const load = (over: Partial<ImageDeps>) => imageLoader(deps(over)).load(WEB, LOCAL)

  it('fetches an https PNG and names its type from the bytes', async () => {
    const asked: string[] = []
    const outcome = await load({ fetchWeb: async url => (asked.push(url), new Response(PNG, { headers: { 'content-type': 'text/plain' } })) })
    expect(outcome).toEqual({ ok: true, type: 'image/png', bytes: PNG })
    expect(asked).toEqual(['https://example.com/c.png'])
  })

  it.each([
    ['JPEG', JPEG, 'image/jpeg'],
    ['GIF', GIF, 'image/gif'],
    ['WebP', WEBP, 'image/webp'],
    ['AVIF', AVIF, 'image/avif'],
    ['AVIF that names avif as a compatible brand', MIF1_AVIF, 'image/avif']
  ])('accepts a %s', async (_, bytes, type) => {
    await expect(load({ fetchWeb: async () => new Response(bytes) })).resolves.toMatchObject({ ok: true, type })
  })

  it('refuses an SVG, even when the server calls it a PNG', async () => {
    await expect(load({ fetchWeb: async () => new Response(SVG, { headers: { 'content-type': 'image/png' } }) })).resolves.toEqual({ ok: false })
  })

  it('refuses bytes that are no image, and an empty body', async () => {
    await expect(load({ fetchWeb: async () => new Response('<html></html>', { headers: { 'content-type': 'image/png' } }) })).resolves.toEqual({ ok: false })
    await expect(load({ fetchWeb: async () => new Response(null) })).resolves.toEqual({ ok: false })
  })

  it('refuses a Content-Length over the cap and stops the transfer', async () => {
    let signal: AbortSignal | undefined
    const fetchWeb = async (_url: string, given: AbortSignal) => (signal = given, new Response(PNG, { headers: { 'content-length': String(CAP + 1) } }))
    await expect(load({ fetchWeb })).resolves.toEqual({ ok: false })
    expect(signal?.aborted).toBe(true)
  })

  it('refuses a stream that grows past the cap and stops reading it', async () => {
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({ pull: controller => { pulled++; controller.enqueue(UNDER_CAP(PNG)) } })
    let signal: AbortSignal | undefined
    await expect(load({ fetchWeb: async (_url, given) => (signal = given, new Response(body)) })).resolves.toEqual({ ok: false })
    expect(pulled).toBeLessThan(5)
    expect(signal?.aborted).toBe(true)
  })

  it('accepts a stream of exactly the cap in several chunks', async () => {
    const whole = UNDER_CAP(PNG)
    const outcome = await load({ fetchWeb: async () => new Response(streamOf(whole.slice(0, 20), whole.slice(20))) })
    expect(outcome).toEqual({ ok: true, type: 'image/png', bytes: whole })
  })

  it('refuses an error status, a network failure and a timeout', async () => {
    await expect(load({ fetchWeb: async () => new Response(PNG, { status: 404 }) })).resolves.toEqual({ ok: false })
    await expect(load({ fetchWeb: async () => { throw new Error('offline') } })).resolves.toEqual({ ok: false })
    await expect(load({
      timeoutMs: 10,
      fetchWeb: (_url, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
    })).resolves.toEqual({ ok: false })
  })

  it('refuses a response that redirected to a url that is not a web link', async () => {
    const response = new Response(PNG)
    Object.defineProperty(response, 'url', { value: 'file:///tmp/shot.png' })
    await expect(load({ fetchWeb: async () => response })).resolves.toEqual({ ok: false })
  })
})

describe('loading a tool image', () => {
  const load = (context: ImageContext, over: Partial<ImageDeps> = {}, path?: string) => imageLoader(deps(over)).load(toolRequest(path), context)

  it('reads a path a finished step named, on a local connection', async () => {
    await expect(load(LOCAL)).resolves.toEqual({ ok: true, type: 'image/png', bytes: PNG })
  })

  it('refuses a remote connection, and never reads the disk for it', async () => {
    let read = false
    await expect(load({ ...LOCAL, local: false }, { readLocal: async () => (read = true, PNG) })).resolves.toEqual({ ok: false })
    expect(read).toBe(false)
  })

  it('refuses a path no step named, and a session the window does not watch', async () => {
    await expect(load(LOCAL, {}, '/etc/passwd')).resolves.toEqual({ ok: false })
    await expect(load({ ...LOCAL, session: sessionWith(null) })).resolves.toEqual({ ok: false })
    await expect(load({ ...LOCAL, session: undefined })).resolves.toEqual({ ok: false })
  })

  it('refuses a step that is still running', async () => {
    const running = { cwd: null, history: [], run: { state: 'running', turn: { items: [{ kind: 'tool', status: { s: 'running', note: null } }] } } } as unknown as Session
    await expect(load({ ...LOCAL, session: running })).resolves.toEqual({ ok: false })
  })

  it('refuses a relative path even when a step named it', async () => {
    await expect(load({ ...LOCAL, session: sessionWith('shot.png') }, {}, 'shot.png')).resolves.toEqual({ ok: false })
  })

  it('refuses an SVG, a missing file and a file over the cap', async () => {
    await expect(load(LOCAL, { readLocal: async () => SVG })).resolves.toEqual({ ok: false })
    await expect(load(LOCAL, { readLocal: async () => 'missing' })).resolves.toEqual({ ok: false })
    await expect(load(LOCAL, { readLocal: async () => 'too-big' })).resolves.toEqual({ ok: false })
  })
})

describe('readLocalFile', () => {
  let folder = ''
  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'highwing-images-'))
    await writeFile(join(folder, 'fits.png'), UNDER_CAP(PNG))
    await writeFile(join(folder, 'big.png'), OVER_CAP(PNG))
  })
  afterAll(() => rm(folder, { recursive: true, force: true }))

  it('reads a file at the cap, refuses one over it by its size, and calls a missing path and a folder missing', async () => {
    expect(Uint8Array.from(await readLocalFile(join(folder, 'fits.png'), CAP) as Uint8Array)).toEqual(UNDER_CAP(PNG))
    await expect(readLocalFile(join(folder, 'big.png'), CAP)).resolves.toBe('too-big')
    await expect(readLocalFile(join(folder, 'gone.png'), CAP)).resolves.toBe('missing')
    await expect(readLocalFile(folder, CAP)).resolves.toBe('missing')
  })

  it('loads a real file through the loader, and refuses one over the cap', async () => {
    const loader = imageLoader(deps({ readLocal: readLocalFile }))
    const named = (path: string) => ({ session: sessionWith(path), local: true })
    const fits = join(folder, 'fits.png')
    const big = join(folder, 'big.png')
    await expect(loader.load(toolRequest(fits), named(fits))).resolves.toMatchObject({ ok: true, type: 'image/png' })
    await expect(loader.load(toolRequest(big), named(big))).resolves.toEqual({ ok: false })
  })
})

describe('the fixture loader', () => {
  const media = { 'https://example.com/c.png': Buffer.from(PNG).toString('base64'), '/tmp/shot.png': Buffer.from(PNG).toString('base64'), 'https://example.com/v.svg': Buffer.from(SVG).toString('base64') }
  const loader = imageLoader({ ...fixtureImageDeps(media), cap: CAP })

  it('answers a web url and a named path from the header, and a key that is not there as missing', async () => {
    await expect(loader.load(WEB, LOCAL)).resolves.toMatchObject({ ok: true, type: 'image/png' })
    await expect(loader.load(toolRequest(), LOCAL)).resolves.toMatchObject({ ok: true, type: 'image/png' })
    await expect(loader.load({ kind: 'web', url: 'https://example.com/other.png' }, LOCAL)).resolves.toEqual({ ok: false })
  })

  it('still sniffs and caps the fixture bytes', async () => {
    await expect(loader.load({ kind: 'web', url: 'https://example.com/v.svg' }, LOCAL)).resolves.toEqual({ ok: false })
    const big = imageLoader({ ...fixtureImageDeps({ 'https://example.com/c.png': Buffer.from(OVER_CAP(PNG)).toString('base64') }), cap: CAP })
    await expect(big.load(WEB, LOCAL)).resolves.toEqual({ ok: false })
  })

  it('has no media without a header field', async () => {
    await expect(imageLoader(fixtureImageDeps(undefined)).load(WEB, LOCAL)).resolves.toEqual({ ok: false })
  })
})

import type { Session } from '@highwing/hermes/domain'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { ImageOutcome, ImageRequest, ImageType } from '../ipc-contract'
import { itemsOf } from './files'

export const IMAGE_CAP = 10 * 1024 * 1024
const WEB_TIMEOUT_MS = 15_000

export interface ImageDeps {
  fetchWeb(url: string, signal: AbortSignal): Promise<Response>
  readLocal(path: string, cap: number): Promise<Uint8Array | 'too-big' | 'missing'>
  readonly cap: number
  readonly timeoutMs: number
}

/** What a request is judged against: the session the window watches, and whether Hermes runs on this machine. */
export interface ImageContext { readonly session: Session | undefined; readonly local: boolean }

export interface ImageLoader { load(request: ImageRequest, context: ImageContext): Promise<ImageOutcome> }

const REFUSED: ImageOutcome = { ok: false }

const startsWith = (bytes: Uint8Array, at: number, ascii: string) => [...ascii].every((char, index) => bytes[at + index] === char.charCodeAt(0))

/** The type comes from the bytes alone: a server's Content-Type and a file's extension are claims. SVG is not here on purpose, it can hold script. */
export function sniff(bytes: Uint8Array): ImageType | null {
  if (bytes[0] === 0x89 && startsWith(bytes, 1, 'PNG\r\n') && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (startsWith(bytes, 0, 'GIF87a') || startsWith(bytes, 0, 'GIF89a')) return 'image/gif'
  if (startsWith(bytes, 0, 'RIFF') && startsWith(bytes, 8, 'WEBP')) return 'image/webp'
  if (startsWith(bytes, 4, 'ftyp') && ftypBrands(bytes).some(brand => brand === 'avif' || brand === 'avis')) return 'image/avif'
  return null
}

/** The major brand, then the compatible brands, read only inside the `ftyp` box. An AVIF may name `mif1` first and `avif` after. */
function ftypBrands(bytes: Uint8Array): string[] {
  const end = Math.min(bytes.length, ((bytes[0]! << 24) | (bytes[1]! << 16) | (bytes[2]! << 8) | bytes[3]!) >>> 0)
  const brand = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  const brands = end >= 12 ? [brand(8)] : []
  for (let at = 16; at + 4 <= end; at += 4) brands.push(brand(at))
  return brands
}

const outcomeOf = (bytes: Uint8Array): ImageOutcome => {
  const type = sniff(bytes)
  return type === null ? REFUSED : { ok: true, type, bytes }
}

function isTooBig(response: Response, cap: number): boolean {
  const length = response.headers.get('content-length')
  return length !== null && Number(length) > cap
}

async function readBody(response: Response, cap: number): Promise<Uint8Array | null> {
  if (response.body === null) return null
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength
    if (size > cap) return null
    chunks.push(chunk)
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) {
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  return bytes
}

async function loadWeb(url: string, deps: ImageDeps): Promise<ImageOutcome> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs)
  try {
    const response = await deps.fetchWeb(url, controller.signal)
    const final = URL.parse(response.url || url)?.protocol
    if (!response.ok || (final !== 'http:' && final !== 'https:') || isTooBig(response, deps.cap)) return REFUSED
    const bytes = await readBody(response, deps.cap)
    return bytes === null ? REFUSED : outcomeOf(bytes)
  } catch {
    return REFUSED
  } finally {
    clearTimeout(timer)
    // Whatever the verdict, stop the transfer: a refused or finished body must not keep its connection open.
    controller.abort()
  }
}

/** Authorization as `openablePath` does it: a path is served only when a finished step of the watched session named it as its image. */
const stepNamed = (session: Session, path: string) => {
  for (const item of itemsOf(session)) {
    if (item.kind === 'tool' && item.status.s === 'done' && item.status.image === path) return true
  }
  return false
}

async function loadTool(path: string, { session, local }: ImageContext, deps: ImageDeps): Promise<ImageOutcome> {
  // On a remote machine the path names a file there, and a file here with the same name is not it.
  if (!local || session === undefined || !isAbsolute(path) || !stepNamed(session, path)) return REFUSED
  try {
    const bytes = await deps.readLocal(path, deps.cap)
    return typeof bytes === 'string' ? REFUSED : outcomeOf(bytes)
  } catch {
    return REFUSED
  }
}

export function imageLoader(deps: ImageDeps): ImageLoader {
  return {
    load: (request, context) => (request.kind === 'web' ? loadWeb(request.url, deps) : loadTool(request.path, context, deps))
  }
}

export async function readLocalFile(path: string, cap: number): Promise<Uint8Array | 'too-big' | 'missing'> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return 'missing'
    if (info.size > cap) return 'too-big'
    const bytes = await readFile(path)
    return bytes.byteLength > cap ? 'too-big' : bytes
  } catch {
    return 'missing'
  }
}

/** `net.fetch` goes through Chromium's network stack, so it honours the system proxy and certificate store as the user's browser does. The global fetch does neither. */
export function desktopImageDeps(net: Pick<Electron.Net, 'fetch'>): ImageDeps {
  return {
    fetchWeb: (url, signal) => net.fetch(url, { signal, credentials: 'omit', redirect: 'follow' }),
    readLocal: readLocalFile,
    cap: IMAGE_CAP,
    timeoutMs: WEB_TIMEOUT_MS
  }
}

/** A fixture run answers from the header's `media` and touches neither the network nor the disk. Sniffing and the cap still apply to these bytes. */
export function fixtureImageDeps(media: Readonly<Record<string, string>> | undefined): ImageDeps {
  const held = (key: string) => (media !== undefined && Object.hasOwn(media, key) ? Buffer.from(media[key]!, 'base64') : null)
  return {
    async fetchWeb(url) {
      const bytes = held(url)
      return bytes === null ? new Response(null, { status: 404 }) : new Response(bytes, { headers: { 'content-length': String(bytes.byteLength) } })
    },
    async readLocal(path, cap) {
      const bytes = held(path)
      return bytes === null ? 'missing' : bytes.byteLength > cap ? 'too-big' : bytes
    },
    cap: IMAGE_CAP,
    timeoutMs: WEB_TIMEOUT_MS
  }
}

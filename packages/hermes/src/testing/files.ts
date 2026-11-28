/**
 * The files of the fake Hermes machine, and Hermes's `GET /api/fs/download` over them (hermes_cli/web_routers/files.py:1533-1557).
 * Their words are their own: a client that read a file at the same path on this computer would get other words.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileNameOf } from '../domain/library'
import { DOWNLOAD_PATH, downloadedOf, downloadPath, type Download } from '../wire/download'
import type { ChatSeed } from './fixture'
import type { Front, Loopback } from './loopback'

/** Absolute path -> the file's text. */
export type FarFiles = { readonly [path: string]: string }

export const isFarFiles = (value: unknown): value is FarFiles =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.entries(value).every(([path, text]) => path.startsWith('/') && typeof text === 'string')

/** What the route reads: the files, and each profile's chats, which own them. */
export interface Drive { readonly files: FarFiles; readonly chats: { readonly [profile: string]: readonly ChatSeed[] } }

export type DownloadAnswer = { readonly status: 200; readonly name: string; readonly bytes: Buffer } | { readonly status: number; readonly detail: string }

/** The chat must be one of the profile's (`_fs_owned_session`, files.py:1335-1347), and the path one of the machine's files. */
export function downloadAnswer({ files, chats }: Drive, query: URLSearchParams, profile: string): DownloadAnswer {
  const sessionId = query.get('session_id')
  const path = query.get('path') ?? ''
  if (sessionId !== null && !chats[profile]?.some(chat => chat.id === sessionId)) return { status: 404, detail: 'Session not found' }
  const text = Object.hasOwn(files, path) ? files[path] : undefined
  return text === undefined ? { status: 404, detail: 'File not found' } : { status: 200, name: fileNameOf(path), bytes: Buffer.from(text) }
}

/** As FastAPI's `FileResponse` sends a file, and `HTTPException` a refusal. */
export function sendDownload(response: ServerResponse, answer: DownloadAnswer): void {
  if ('detail' in answer) return void response.writeHead(answer.status, { 'content-type': 'application/json' }).end(JSON.stringify({ detail: answer.detail }))
  response.writeHead(200, {
    'content-type': 'application/octet-stream', 'content-length': answer.bytes.byteLength, 'content-disposition': `attachment; filename="${answer.name}"`
  }).end(answer.bytes)
}

const refuse = (response: ServerResponse, status: number, detail: string) => sendDownload(response, { status, detail })

/**
 * The gateway's own HTTP listener, behind the `native-http` gate (dashboard_auth/native_http.py:286-310): one ticket header and
 * no `Origin`, a ticket used once, and a `?profile=` that names the ticket's own profile. Omitted, the profile is the ticket's.
 */
export function ticketedFiles(gateway: Pick<Loopback, 'redeemHttp'>, drive: Drive): Front {
  const serve = (request: IncomingMessage, response: ServerResponse) => {
    const { pathname, searchParams } = new URL(request.url ?? '/', 'http://loopback')
    const tickets = request.headersDistinct['x-hermes-gateway-ticket'] ?? []
    const profile = tickets.length !== 1 || request.headers.origin !== undefined ? null : gateway.redeemHttp(tickets[0] as string)
    if (profile === null) return refuse(response, 401, 'Unauthorized')
    if (searchParams.getAll('profile').some(asked => asked !== profile)) return refuse(response, 403, 'profile_scope_mismatch')
    if (request.method !== 'GET' || pathname !== DOWNLOAD_PATH) return refuse(response, 404, 'Not Found')
    sendDownload(response, downloadAnswer(drive, searchParams, profile))
  }
  return { prefix: '', upgrades: 'gateway', serve }
}

/** The route as a fixture run's connection answers it, through the same reading of Hermes's answer as a live route. No `files`: no route. */
export function fixtureDownload(files: FarFiles | undefined, chats: Drive['chats'] = {}): Download {
  return async file => {
    const answer = files === undefined ? { status: 404, detail: 'Not Found' } : downloadAnswer({ files, chats }, new URL(downloadPath(file), 'http://fixture').searchParams, file.bot)
    const bytes = 'bytes' in answer ? answer.bytes : Buffer.from(JSON.stringify({ detail: answer.detail }))
    const header = (name: string) => (name === 'content-disposition' && 'bytes' in answer ? `attachment; filename="${answer.name}"` : null)
    return downloadedOf({ status: answer.status, header, body: (async function* () { yield bytes })() }, file)
  }
}

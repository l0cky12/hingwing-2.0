/**
 * One file of the Hermes machine through Hermes's own download route (hermes_cli/web_routers/files.py:1533-1557). Every route
 * reads Hermes's answer here, and adds only its credential: a `native-http` ticket for the file's bot, or the address's sign-in.
 */
import type { Outcome, Refusal } from '../domain/command'
import { fileNameOf, type FarFile } from '../domain/library'
import type { TicketRefusal } from './ssh'
import { sentence } from './transcribe'

/** One file of a bot's chat, whole, from the machine Hermes runs on. A refusal's message is plain words for the Library. */
export type Download = (file: FarFile, signal?: AbortSignal) => Promise<Outcome<Uint8Array>>

export const DOWNLOAD_PATH = '/api/fs/download'
export const downloadPath = ({ bot, sessionId, path }: FarFile): string =>
  `${DOWNLOAD_PATH}?${new URLSearchParams({ path, profile: bot, session_id: sessionId })}`

export const WHOLE_DOWNLOAD_MS = 120_000
/** How long an ssh relay waits for Hermes to start answering: a profile with an ssh workspace streams from a third machine. */
export const DOWNLOAD_FIRST_BYTE_MS = 30_000
/** The file is held whole before Highwing asks where to put it, so nothing half-sent is ever written. */
export const MOST_BYTES = 100 * 1024 * 1024
const DETAIL_BYTES = 64 * 1024

export interface Answered {
  readonly status: number
  header(name: string): string | null
  readonly body: AsyncIterable<Uint8Array> | null
}

const refused = (kind: Refusal['kind'], message: string): Outcome<never> => ({ ok: false, refusal: { kind, message } })

export const CANT_SEND = refused('unsupported', "This Hermes can't send files to Highwing. Update Hermes, then try again.")
export const cantReach = (file: FarFile): Outcome<never> => refused('offline', `Highwing couldn't reach Hermes to get ${fileNameOf(file.path)}.`)

/** What a `--serve` that minted no ticket for the file's bot means. A malformed request line is Highwing's own fault, not an older Hermes. */
const UNMINTED: { readonly [W in TicketRefusal]: (file: FarFile) => Outcome<never> } = {
  unsupported: () => CANT_SEND,
  'unknown-profile': ({ bot }) => refused('stale', `Hermes has no bot named ${bot} any more.`),
  'not-served': ({ bot }) => refused('unsupported', `The running Hermes doesn't serve ${bot}, so it can't send ${bot}'s files.`),
  malformed: cantReach,
  unavailable: cantReach
}
export const unminted = (why: TicketRefusal, file: FarFile): Outcome<never> => UNMINTED[why](file)

const said = (detail: string | null) => (detail === null ? '' : ` ${sentence(detail)}`)

/**
 * Hermes's refusals, first match wins. FastAPI's own 404 `Not Found` and a 405 are a Hermes with no such route, and a 403
 * `profile_scope_mismatch` one that took the ticket but not its profile: all three are an older Hermes.
 */
const REFUSALS: readonly (readonly [(status: number, detail: string | null) => boolean, (name: string, detail: string | null) => Outcome<never>])[] = [
  [(status, detail) => (status === 404 && detail === 'Not Found') || status === 405 || (status === 403 && detail === 'profile_scope_mismatch'), () => CANT_SEND],
  [(status, detail) => status === 404 && detail === 'File not found', name => refused('stale', `${name} isn't there any more.`)],
  [(status, detail) => status === 404 && detail === 'Session not found', name => refused('stale', `Hermes no longer has the chat that made ${name}.`)],
  [status => status === 404, (name, detail) => refused('stale', `Hermes couldn't find ${name}.${said(detail)}`)],
  [status => status === 403, (name, detail) => refused('rejected', `Hermes won't send ${name}.${said(detail)}`)],
  [status => status === 409, name => refused('conflict', `Hermes is using ${name}, so it can't send it now. Try again later.`)],
  [status => status === 400, (name, detail) => refused('rejected', `Hermes can't send ${name}.${said(detail)}`)]
]

class Cut extends Error {}

async function bytesOf(body: AsyncIterable<Uint8Array> | null, most: number): Promise<Uint8Array | 'over'> {
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for await (const chunk of body ?? []) {
      size += chunk.byteLength
      if (size > most) return 'over'
      chunks.push(chunk)
    }
  } catch {
    throw new Cut()
  }
  const joined = Buffer.concat(chunks)
  return new Uint8Array(joined.buffer, joined.byteOffset, joined.byteLength)
}

function detailOf(bytes: Uint8Array | 'over'): string | null {
  if (bytes === 'over') return null
  try {
    const body: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'))
    const detail = body !== null && typeof body === 'object' ? (body as { readonly detail?: unknown }).detail : null
    return typeof detail === 'string' && detail.trim() !== '' ? detail.trim() : null
  } catch {
    return null
  }
}

/**
 * Hermes's answer as the file, or as words. A file comes as an attachment, whole, and no bigger than `MOST_BYTES`. Any other
 * status is read for its JSON `detail`. A status no rule names, a 401 on a ticket among them, is Hermes out of reach.
 */
export async function downloadedOf(answer: Answered, file: FarFile): Promise<Outcome<Uint8Array>> {
  const name = fileNameOf(file.path)
  try {
    if (answer.status !== 200) {
      const detail = detailOf(await bytesOf(answer.body, DETAIL_BYTES).catch(() => 'over' as const))
      return REFUSALS.find(([matches]) => matches(answer.status, detail))?.[1](name, detail) ?? cantReach(file)
    }
    // A 200 that is no attachment is not this route: a page some older listener serves for any path.
    if (!/^attachment\b/i.test(answer.header('content-disposition') ?? '')) return CANT_SEND
    const length = Number(answer.header('content-length') ?? Number.NaN)
    const tooBig = refused('rejected', `${name} is over ${MOST_BYTES / 1024 / 1024} MB. Highwing saves files up to ${MOST_BYTES / 1024 / 1024} MB from Hermes.`)
    if (length > MOST_BYTES) return tooBig
    const bytes = await bytesOf(answer.body, MOST_BYTES)
    if (bytes === 'over') return tooBig
    if (Number.isSafeInteger(length) && bytes.byteLength !== length) throw new Cut()
    return { ok: true, value: bytes }
  } catch (error) {
    if (error instanceof Cut) return refused('offline', `${name} stopped coming before it was whole, so Highwing saved nothing.`)
    throw error
  }
}

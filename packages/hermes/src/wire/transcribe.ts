/**
 * Speech to text through Hermes's own upload route (hermes_cli/web_routers/audio.py:89-150). The
 * gateway's socket carries no transcription, so each route posts the recording to the gateway's
 * HTTP listener with the credential its kind of connection holds.
 */
import { request } from 'node:http'
import type { Outcome, Recording } from '../domain/command'

/** Turns one recording into text. A refusal's message is plain words for the composer to show. */
export type Transcribe = (recording: Recording, signal?: AbortSignal) => Promise<Outcome<string>>

export const TRANSCRIBE_PATH = '/api/audio/transcribe'
/** Hermes answers only once the text is ready, and a local model on a slow machine takes its time. */
export const TRANSCRIBE_MS = 120_000

type Obj = Readonly<Record<string, unknown>>
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The JSON body the route reads: the recording as a base64 data URL, and its type. */
export const transcribeBody = ({ mime, audio }: Recording): Obj =>
  ({ data_url: `data:${mime};base64,${Buffer.from(audio).toString('base64')}`, mime_type: mime })

export const CANT_REACH: Outcome<never> = { ok: false, refusal: { kind: 'offline', message: "Highwing can't reach Hermes, so it couldn't turn that into text." } }
export const CANT_TRANSCRIBE: Outcome<never> = {
  ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't turn speech into text for Highwing. Update Hermes, then try again." }
}

const sentence = (words: string) => (/[.!?]$/.test(words) ? words : `${words}.`)

/** What Hermes's answer means. An empty transcript is a success: Hermes heard no words. */
export function transcriptOf(status: number, body: unknown): Outcome<string> {
  if (status === 200 && isObject(body) && body.ok === true && typeof body.transcript === 'string') return { ok: true, value: body.transcript.trim() }
  if (status === 404 || status === 405) return CANT_TRANSCRIBE
  const detail = isObject(body) && typeof body.detail === 'string' && body.detail.trim() !== '' ? ` ${sentence(body.detail.trim())}` : ''
  return { ok: false, refusal: { kind: 'rejected', message: `Hermes couldn't turn that into text.${detail}` } }
}

function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/**
 * One request to a gateway's loopback listener with a `native-http` ticket. Hermes's gate refuses a ticket that comes with an
 * `Origin` header (dashboard_auth/native_http.py:200), which `fetch` may add, so this goes through `node:http`. One request per
 * connection, so a relay that carries one connection carries all of it.
 */
export function requestWithTicket(
  origin: string, ticket: string, ask: { readonly method: 'GET' | 'POST' | 'PUT'; readonly path: string; readonly json?: unknown; readonly ms: number }, signal?: AbortSignal
): Promise<{ readonly status: number; readonly body: unknown }> {
  const body = ask.json === undefined ? null : JSON.stringify(ask.json)
  const deadline = AbortSignal.timeout(ask.ms)
  return new Promise((resolve, reject) => {
    const url = new URL(ask.path, origin)
    if (url.origin !== new URL(origin).origin) return reject(new Error('The request names another address than the gateway.'))
    const asked = request(url, {
      method: ask.method,
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
      headers: {
        accept: 'application/json',
        ...(body === null ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }),
        'x-hermes-gateway-ticket': ticket,
        connection: 'close'
      }
    }, response => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => resolve({ status: response.statusCode ?? 0, body: jsonOf(Buffer.concat(chunks).toString('utf8')) }))
      response.on('error', reject)
    })
    asked.on('error', reject)
    asked.end(body ?? undefined)
  })
}

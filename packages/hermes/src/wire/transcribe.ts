/**
 * Speech to text through Hermes's own upload route (hermes_cli/web_routers/audio.py:89-150). The
 * gateway's socket carries no transcription, so each route posts the recording to the gateway's
 * HTTP listener with the credential its kind of connection holds.
 */
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

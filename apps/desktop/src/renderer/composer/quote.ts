import type { Quote } from '../../ipc-contract'

/**
 * Hermes's own gateway frames a platform reply this way (gateway/inbound_reply_context.py), and its
 * compactor strips exactly this shape (agent/context_compressor.py), so the quote never reads as the request.
 */
const POINTER = /^\[Replying to( your previous message)?: "(.*?)"\]\n\n/s

export function withQuote(quote: Quote | null, body: string): string {
  if (quote === null) return body
  return `[Replying to${quote.from === 'hermes' ? ' your previous message' : ''}: "${quote.text}"]\n\n${body}`
}

export function quoteOf(message: string): { readonly quote: Quote | null; readonly body: string } {
  const found = POINTER.exec(message)
  const text = found?.[2] ?? ''
  const body = message.slice(found?.[0].length ?? 0)
  if (text.trim() === '' || body.trim() === '') return { quote: null, body: message }
  return { quote: { from: found?.[1] === undefined ? 'you' : 'hermes', text }, body }
}

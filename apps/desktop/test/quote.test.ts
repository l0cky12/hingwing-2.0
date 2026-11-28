import { describe, expect, it } from 'vitest'
import type { Quote } from '../src/ipc-contract'
import { quoteOf, withQuote } from '../src/renderer/composer/quote'

/** Hermes's compactor (agent/context_compressor.py `_GATEWAY_REPLY_POINTER_RE`), which strips a reply's quote so it never reads as the request. */
const HERMES_STRIPS = /^(?:\[Triggering message id: [^\n]*\]\n\n)?\[Replying to(?: your previous message| an earlier scheduled cron delivery \([^)\n]*\))?: ".*?"\]\n\n/s

const FROM_HERMES: Quote = { from: 'hermes', text: 'The folder holds two files.' }
const FROM_YOU: Quote = { from: 'you', text: 'List the folder' }

describe('a quote on its way to Hermes', () => {
  it('is framed the way Hermes frames a reply to its own message, and to one of yours', () => {
    expect(withQuote(FROM_HERMES, 'Which is newer?')).toBe('[Replying to your previous message: "The folder holds two files."]\n\nWhich is newer?')
    expect(withQuote(FROM_YOU, 'Only the notes, please.')).toBe('[Replying to: "List the folder"]\n\nOnly the notes, please.')
  })

  it('leaves a message with no quote as typed', () => {
    expect(withQuote(null, 'Which is newer?')).toBe('Which is newer?')
  })

  it.each([
    ['a reply to Hermes', FROM_HERMES, 'Which is newer?'],
    ['a reply to you', FROM_YOU, 'Only the notes.'],
    ['a quote of several lines', { from: 'hermes', text: 'First line.\n\nSecond paragraph.\n- a list' }, 'Shorten it.\nThanks.'],
    ['a quote that holds quote marks', { from: 'you', text: 'Rename "draft.md" to "final.md"' }, 'Did "final.md" stick?']
  ] as const)('is stripped by Hermes down to the body for %s', (_what, quote, body) => {
    expect(withQuote(quote, body).replace(HERMES_STRIPS, '')).toBe(body)
  })
})

describe('a sent message read back', () => {
  it.each([
    ['a reply to Hermes', FROM_HERMES, 'Which is newer?'],
    ['a reply to you', FROM_YOU, 'Only the notes.'],
    ['a quote of several lines', { from: 'hermes', text: 'First line.\n\nSecond paragraph.' }, 'Shorten it.\n\nThanks.'],
    ['a quote that holds quote marks', { from: 'you', text: 'Rename "draft.md" to "final.md"' }, 'Did "final.md" stick?']
  ] as const)('gives back the quote and body of %s', (_what, quote, body) => {
    expect(quoteOf(withQuote(quote, body))).toEqual({ quote, body })
  })

  it('has no quote when nothing frames one', () => {
    expect(quoteOf('List the folder')).toEqual({ quote: null, body: 'List the folder' })
    expect(quoteOf('Hi\n\n[Replying to: "x"]\n\nlater')).toEqual({ quote: null, body: 'Hi\n\n[Replying to: "x"]\n\nlater' })
  })

  it('has no quote when nothing follows it, or the quote is blank, so the message shows whole', () => {
    expect(quoteOf('[Replying to: "List the folder"]\n\n')).toEqual({ quote: null, body: '[Replying to: "List the folder"]\n\n' })
    expect(quoteOf('[Replying to: " "]\n\nWhy?')).toEqual({ quote: null, body: '[Replying to: " "]\n\nWhy?' })
  })

  it('splits where Hermes does, so sending the parts again sends the same message', () => {
    const message = '[Replying to: "a "]\n\n" b"]\n\nWhy?'
    const { quote, body } = quoteOf(message)
    expect(message.slice(0, message.length - body.length)).toBe(message.match(HERMES_STRIPS)?.[0])
    expect(withQuote(quote, body)).toBe(message)
  })
})

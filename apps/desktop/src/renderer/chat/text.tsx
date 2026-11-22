import type { Phrase } from '@highwing/thread'
import { Fragment, type ReactNode } from 'react'

export function PhraseText({ words }: { readonly words: Phrase }) {
  return words.map((piece, index) => (piece.t === 'code' ? <code key={index}>{piece.v}</code> : <Fragment key={index}>{piece.v}</Fragment>))
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\n)/

function inline(paragraph: string): ReactNode[] {
  return paragraph.split(INLINE).filter(Boolean).map((part, index) => {
    if (part === '\n') return <br key={index} />
    if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>
    if (part.startsWith('**')) return <b key={index}>{part.slice(2, -2)}</b>
    return <Fragment key={index}>{part}</Fragment>
  })
}

export function Markdown({ source, caret }: { readonly source: string; readonly caret: boolean }) {
  const blocks = source.split(/```[\w-]*\n?/).flatMap((chunk, index) => index % 2 === 1
    ? [{ code: true, text: chunk.replace(/\n$/, '') }]
    : chunk.split(/\n{2,}/).filter(block => block.trim() !== '').map(text => ({ code: false, text })))
  return blocks.map((block, index) => {
    const tail = caret && index === blocks.length - 1 ? <span className="caret" /> : null
    return block.code
      ? <pre key={index}><code>{block.text}</code>{tail}</pre>
      : <p key={index}>{inline(block.text)}{tail}</p>
  })
}

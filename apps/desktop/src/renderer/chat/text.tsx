import { proseBlocks, type Phrase, type ProseBlock } from '@highwing/thread'
import { Fragment } from 'react'

export function PhraseText({ words }: { readonly words: Phrase }) {
  return words.map((piece, index) => (piece.t === 'code' ? <code key={index}>{piece.v}</code> : <Fragment key={index}>{piece.v}</Fragment>))
}

function Pieces({ pieces }: { readonly pieces: ProseBlock['pieces'] }) {
  return pieces.map((piece, index) => {
    switch (piece.t) {
      case 'br': return <br key={index} />
      case 'code': return <code key={index}>{piece.v}</code>
      case 'bold': return <b key={index}>{piece.v}</b>
      case 'text': return <Fragment key={index}>{piece.v}</Fragment>
    }
  })
}

export function Markdown({ source, caret }: { readonly source: string; readonly caret: boolean }) {
  const blocks = proseBlocks(source)
  return blocks.map((block, index) => {
    const tail = caret && index === blocks.length - 1 ? <span className="caret" /> : null
    return block.code
      ? <pre key={index}><code><Pieces pieces={block.pieces} /></code>{tail}</pre>
      : <p key={index}><Pieces pieces={block.pieces} />{tail}</p>
  })
}

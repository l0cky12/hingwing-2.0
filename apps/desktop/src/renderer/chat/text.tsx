import { fieldId, proseBlocks, type Phrase, type ProseRun } from '@highwing/thread'
import { Fragment } from 'react'

export function PhraseText({ words }: { readonly words: Phrase }) {
  return words.map((piece, index) => (piece.t === 'code' ? <code key={index}>{piece.v}</code> : <Fragment key={index}>{piece.v}</Fragment>))
}

function Runs({ runs }: { readonly runs: readonly ProseRun[] }) {
  return runs.map((run, index) => {
    switch (run.t) {
      case 'br': return <br key={index} />
      case 'code': return <code key={index}>{run.v}</code>
      case 'bold': return <b key={index}>{run.v}</b>
      case 'text': return <Fragment key={index}>{run.v}</Fragment>
    }
  })
}

interface MarkdownProps {
  readonly source: string
  readonly caret: boolean
  readonly nodeKey: string
}

export function Markdown({ source, caret, nodeKey }: MarkdownProps) {
  const blocks = proseBlocks(source)
  return blocks.map((block, index) => {
    const tail = caret && index === blocks.length - 1 ? <span className="caret" /> : null
    const find = fieldId(nodeKey, `block ${index}`)
    return block.code
      ? <pre key={index} data-find={find}><code>{block.text}</code>{tail}</pre>
      : <p key={index} data-find={find}><Runs runs={block.runs} />{tail}</p>
  })
}

import { fieldId, parseMarkdown, proseLeaves, type Block, type Inline, type Phrase, type ProseLeaf } from '@highwing/thread'
import { Fragment, useMemo, type ReactNode } from 'react'
import { isWebLink } from '../../ipc-contract'
import { CopyButton } from './Copy'

export function PhraseText({ words }: { readonly words: Phrase }) {
  return words.map((piece, index) => (piece.t === 'code' ? <code key={index}>{piece.v}</code> : <Fragment key={index}>{piece.v}</Fragment>))
}

function inline(nodes: readonly Inline[]): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.t) {
      case 'text': return <Fragment key={index}>{node.v}</Fragment>
      case 'code': return <code key={index}>{node.v}</code>
      case 'strong': return <strong key={index}>{inline(node.children)}</strong>
      case 'em': return <em key={index}>{inline(node.children)}</em>
      case 'del': return <del key={index}>{inline(node.children)}</del>
      case 'break': return <br key={index} />
      case 'link':
        return isWebLink(node.href)
          ? <a key={index} href={node.href} target="_blank" rel="noreferrer">{inline(node.children)}</a>
          : <Fragment key={index}>{inline(node.children)}</Fragment>
      default: return node satisfies never
    }
  })
}

const HEADING = { 1: 'h1', 2: 'h2', 3: 'h3', 4: 'h4', 5: 'h5', 6: 'h6' } as const

type FindIds = ReadonlyMap<ProseLeaf, string>

function item(blocks: readonly Block[], index: number, tail: ReactNode, ids: FindIds) {
  const [only] = blocks
  if (only === undefined) return <li key={index}>{tail}</li>
  return blocks.length === 1 && only.kind === 'paragraph'
    ? <li key={index} data-find={ids.get(only.inline)}>{inline(only.inline)}{tail}</li>
    : <li key={index}>{blockList(blocks, tail, ids)}</li>
}

function cells(row: readonly (readonly Inline[])[], align: Extract<Block, { kind: 'table' }>['align'], ids: FindIds, Cell: 'th' | 'td') {
  return row.map((cell, column) => <Cell key={column} data-find={ids.get(cell)} style={{ textAlign: align[column] ?? undefined }}>{inline(cell)}</Cell>)
}

/** `tail` is the streaming caret, drawn inside the deepest last element that holds text. */
function block(node: Block, key: number, tail: ReactNode, ids: FindIds): ReactNode {
  switch (node.kind) {
    case 'paragraph': return <p key={key} data-find={ids.get(node.inline)}>{inline(node.inline)}{tail}</p>
    case 'heading': {
      const Heading = HEADING[node.level]
      return <Heading key={key} data-find={ids.get(node.inline)}>{inline(node.inline)}{tail}</Heading>
    }
    case 'list': {
      const items = node.items.map((blocks, index) => item(blocks, index, index === node.items.length - 1 ? tail : null, ids))
      return node.ordered ? <ol key={key} start={node.start}>{items}</ol> : <ul key={key}>{items}</ul>
    }
    case 'quote': return <blockquote key={key}>{blockList(node.blocks, tail, ids)}</blockquote>
    case 'code':
      return (
        <div key={key} className="code">
          <pre data-find={ids.get(node)}><code>{node.text}</code>{tail}</pre>
          <div className="chip">{node.lang !== null && <span className="lang">{node.lang}</span>}<CopyButton text={node.text} name="Copy code" /></div>
        </div>
      )
    case 'table':
      return (
        <Fragment key={key}>
          <div className="table" role="region" aria-label="Table" tabIndex={0}>
            <table>
              <thead><tr>{cells(node.head, node.align, ids, 'th')}</tr></thead>
              <tbody>{node.rows.map((row, index) => <tr key={index}>{cells(row, node.align, ids, 'td')}</tr>)}</tbody>
            </table>
          </div>
          {tail}
        </Fragment>
      )
    case 'rule': return <Fragment key={key}><hr />{tail}</Fragment>
    default: return node satisfies never
  }
}

function blockList(blocks: readonly Block[], tail: ReactNode, ids: FindIds): ReactNode[] {
  return blocks.map((node, index) => block(node, index, index === blocks.length - 1 ? tail : null, ids))
}

interface MarkdownProps {
  readonly source: string
  readonly caret: boolean
  readonly nodeKey: string
}

export function Markdown({ source, caret, nodeKey }: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source])
  const ids = useMemo(() => new Map(proseLeaves(blocks).map((leaf, index) => [leaf, fieldId(nodeKey, `block ${index}`)])), [blocks, nodeKey])
  return blockList(blocks, caret ? <span className="caret" /> : null, ids)
}

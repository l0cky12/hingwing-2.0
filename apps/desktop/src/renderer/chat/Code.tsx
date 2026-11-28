import type { Block } from '@highwing/thread'
import { useEffect, useMemo, useReducer, type ReactNode } from 'react'
import { CopyIcon } from './Copy'
import { grammarFor, highlight, loadGrammar } from './highlight'

const MAX_HIGHLIGHT_CHARS = 100_000

interface CodeProps {
  readonly node: Extract<Block, { kind: 'code' }>
  readonly caret: ReactNode
  readonly findId: string | undefined
}

export function Code({ node, caret, findId }: CodeProps) {
  const grammar = node.open || node.text.length > MAX_HIGHLIGHT_CHARS ? null : grammarFor(node.lang)
  const [loads, loaded] = useReducer((count: number) => count + 1, 0)
  const html = useMemo(() => (grammar === null ? null : highlight(node.text, grammar)), [grammar, node.text, loads])
  const waiting = grammar !== null && html === null
  useEffect(() => {
    if (!waiting) return
    let mounted = true
    void loadGrammar(grammar).then(() => { if (mounted) loaded() })
    return () => { mounted = false }
  }, [grammar, waiting])
  return (
    <div className="code" data-open={node.open || undefined}>
      <div className="code-head">{node.lang !== null && <span className="lang">{node.lang}</span>}<CopyIcon text={node.text} name="Copy code" /></div>
      <pre data-find={findId}>{html === null ? <code>{node.text}</code> : <code dangerouslySetInnerHTML={{ __html: html }} />}{caret}</pre>
    </div>
  )
}

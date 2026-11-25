import type { Block } from '@highwing/thread'
import { useEffect, useState } from 'react'
import { CopyButton } from './Copy'
import { drawDiagram, drawnBefore, type Drawing } from './diagrams'

type View = 'diagram' | 'source'

function useDrawing(source: string): Drawing {
  const [result, setResult] = useState(() => ({ source, drawing: drawnBefore(source) }))
  useEffect(() => {
    let mounted = true
    void drawDiagram(source).then(drawing => { if (mounted) setResult({ source, drawing }) })
    return () => { mounted = false }
  }, [source])
  return result.source === source ? result.drawing : drawnBefore(source)
}

const firstLine = (source: string) => source.split('\n').find(line => line.trim() !== '')?.trim() ?? ''

interface DiagramProps {
  readonly node: Extract<Block, { kind: 'code' }>
  readonly findId: string | undefined
}

export function Diagram({ node, findId }: DiagramProps) {
  const drawing = useDrawing(node.text)
  const [view, setView] = useState<View>('diagram')
  const shown = drawing.status === 'drawn' && view === 'diagram' ? drawing.svg : null
  return (
    <div className="code diagram" data-state={drawing.status}>
      {shown !== null && <div className="drawn" role="img" aria-label={`Diagram: ${firstLine(node.text)}`} dangerouslySetInnerHTML={{ __html: shown }} />}
      <pre data-find={findId} hidden={shown !== null}><code>{node.text}</code></pre>
      {drawing.status === 'failed' && <p className="undrawn">Couldn’t draw this diagram.</p>}
      <div className="chip">
        <span className="lang">{node.lang}</span>
        {drawing.status !== 'failed' && (
          <>
            <button type="button" className="view" aria-pressed={view === 'diagram'} onClick={() => setView('diagram')}>Diagram</button>
            <button type="button" className="view" aria-pressed={view === 'source'} onClick={() => setView('source')}>Source</button>
          </>
        )}
        <CopyButton text={node.text} name="Copy code" />
      </div>
    </div>
  )
}

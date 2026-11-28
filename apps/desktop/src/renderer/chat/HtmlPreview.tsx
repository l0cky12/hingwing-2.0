import type { CodeBlock } from '@highwing/thread'
import { useState } from 'react'
import { CopyIcon } from './Copy'

type View = 'preview' | 'source'

interface HtmlPreviewProps {
  readonly node: CodeBlock
  readonly findId: string | undefined
}

/** An empty `sandbox` gives the page no scripts, forms, popups or origin, so a reply's HTML can only be looked at. */
export function HtmlPreview({ node, findId }: HtmlPreviewProps) {
  const [view, setView] = useState<View>('preview')
  return (
    <div className="code html-preview">
      <div className="code-head">
        <span className="lang">{node.lang}</span>
        <button type="button" className="view" aria-pressed={view === 'preview'} onClick={() => setView('preview')}>Preview</button>
        <button type="button" className="view" aria-pressed={view === 'source'} onClick={() => setView('source')}>Source</button>
        <CopyIcon text={node.text} name="Copy code" />
      </div>
      {view === 'preview' && <iframe sandbox="" srcDoc={node.text} title="HTML preview" />}
      <pre data-find={findId} hidden={view === 'preview'}><code>{node.text}</code></pre>
    </div>
  )
}

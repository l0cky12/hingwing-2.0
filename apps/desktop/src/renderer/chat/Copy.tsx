import type { SessionId } from '@highwing/hermes/domain'
import { fieldId } from '@highwing/thread'
import { useEffect, useRef, useState } from 'react'
import { chatLink } from '../../chat-link'

const SHOWN_MS = 2000

const WORDS = { copied: 'Copied', failed: 'Couldn’t copy' } as const

export function useCopy(): { readonly said: string | null; readonly copy: (text: string) => void } {
  const [outcome, setOutcome] = useState<keyof typeof WORDS | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const show = (next: keyof typeof WORDS) => {
    setOutcome(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOutcome(null), SHOWN_MS)
  }
  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(() => show('copied'), () => show('failed'))
  }
  return { said: outcome === null ? null : WORDS[outcome], copy }
}

export function CopyButton({ text, name }: { readonly text: string; readonly name: string }) {
  const { said, copy } = useCopy()
  return (
    <>
      <button type="button" className={said === null ? 'copy' : 'copy shown'} aria-label={name} onClick={() => copy(text)}>
        {said ?? 'Copy'}
      </button>
      <span className="sr" aria-live="polite">{said ?? ''}</span>
    </>
  )
}

export function CopyLink({ sessionId }: { readonly sessionId: SessionId }) {
  const { said, copy } = useCopy()
  return (
    <>
      <button type="button" aria-label="Copy link" onClick={() => copy(chatLink(sessionId))}>{said ?? 'Copy link'}</button>
      <span className="sr" aria-live="polite">{said ?? ''}</span>
    </>
  )
}

export function Command({ nodeKey, command }: { readonly nodeKey: string; readonly command: string }) {
  return <div className="copyable"><pre data-find={fieldId(nodeKey, 'command')}>{command}</pre><CopyButton text={command} name="Copy command" /></div>
}

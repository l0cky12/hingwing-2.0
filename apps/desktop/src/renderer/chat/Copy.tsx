import { fieldId } from '@highwing/thread'
import { useEffect, useRef, useState } from 'react'

const SHOWN_MS = 2000

const WORDS = { copied: 'Copied', failed: 'Couldn’t copy' } as const

type Outcome = keyof typeof WORDS | null

export function CopyButton({ text, name }: { readonly text: string; readonly name: string }) {
  const [outcome, setOutcome] = useState<Outcome>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const show = (next: Outcome) => {
    setOutcome(next)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setOutcome(null), SHOWN_MS)
  }
  const press = () => {
    navigator.clipboard.writeText(text).then(() => show('copied'), () => show('failed'))
  }
  return (
    <>
      <button type="button" className={outcome === null ? 'copy' : 'copy shown'} aria-label={name} onClick={press}>
        {outcome === null ? 'Copy' : WORDS[outcome]}
      </button>
      <span className="sr" aria-live="polite">{outcome === null ? '' : WORDS[outcome]}</span>
    </>
  )
}

export function Command({ nodeKey, command }: { readonly nodeKey: string; readonly command: string }) {
  return <div className="copyable"><pre data-find={fieldId(nodeKey, 'command')}>{command}</pre><CopyButton text={command} name="Copy command" /></div>
}

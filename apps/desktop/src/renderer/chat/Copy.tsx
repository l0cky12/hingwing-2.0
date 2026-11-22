import { useEffect, useRef, useState } from 'react'

const SHOWN_MS = 2000

type Outcome = 'copied' | 'failed' | null

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
      <button type="button" className="copy" aria-label={name} onClick={press}>
        {outcome === 'copied' ? 'Copied' : outcome === 'failed' ? 'Couldn’t copy' : 'Copy'}
      </button>
      <span className="sr" aria-live="polite">{outcome === 'copied' ? 'Copied' : ''}</span>
    </>
  )
}

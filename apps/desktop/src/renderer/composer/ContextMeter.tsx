import type { CommandOutcome, ContextBreakdown, ContextFill } from '@highwing/hermes/domain'
import { useEffect, useId, useRef, useState } from 'react'

interface ContextMeterProps {
  readonly fill: ContextFill
  readonly stale: boolean
  readonly onBreakdown: () => Promise<CommandOutcome<ContextBreakdown>>
}

const NEARLY_FULL_ABOVE = 80

const WHOLE = new Intl.NumberFormat('en-US')

export function shortCount(tokens: number): string {
  if (tokens < 1000) return WHOLE.format(tokens)
  const [scaled, unit] = tokens < 999_950 ? [tokens / 1000, 'k'] : [tokens / 1_000_000, 'M']
  return `${Math.round(scaled * 10) / 10}${unit}`
}

type Split =
  | { readonly at: 'reading' }
  | { readonly at: 'read'; readonly breakdown: ContextBreakdown }
  | { readonly at: 'refused'; readonly message: string }

export function ContextMeter({ fill, stale, onBreakdown }: ContextMeterProps) {
  const [split, setSplit] = useState<Split | null>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const asked = useRef(0)
  const splitId = useId()
  const open = split !== null
  const close = () => {
    asked.current++
    setSplit(null)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      close()
      button.current?.focus()
    }
    const onPress = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node)) close() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPress)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPress)
    }
  }, [open])

  const toggle = async () => {
    if (open) return close()
    const request = ++asked.current
    setSplit({ at: 'reading' })
    const outcome = await onBreakdown()
    if (request !== asked.current) return
    setSplit(outcome.ok ? { at: 'read', breakdown: outcome.value } : { at: 'refused', message: outcome.refusal.message })
  }

  const percent = `${fill.estimated ? 'about ' : ''}${fill.percent}%`
  const near = fill.percent > NEARLY_FULL_ABOVE
  const marks = `${near ? ', nearly full' : ''}${stale ? ' (stale)' : ''}`

  return (
    <div className="context" ref={anchor}>
      <button
        ref={button} type="button" className={`meter${near ? ' near' : ''}${stale ? ' stale' : ''}`}
        aria-label={`Context ${percent} full${marks}`} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? splitId : undefined}
        onClick={() => void toggle()}
      >
        <span className="gauge" aria-hidden="true"><span style={{ width: `${fill.percent}%` }} /></span>
        {percent}{marks}
      </button>
      {split !== null && (
        <div className="split" id={splitId} role="dialog" aria-label="What fills the context">
          {split.at === 'reading' && <p role="status">Reading what fills the context.</p>}
          {split.at === 'refused' && <p className="err">{split.message}</p>}
          {split.at === 'read' && <Breakdown breakdown={split.breakdown} />}
        </div>
      )}
    </div>
  )
}

function Breakdown({ breakdown }: { readonly breakdown: ContextBreakdown }) {
  const { categories, used, max, model } = breakdown
  const free = Math.max(0, max - categories.reduce((sum, category) => sum + category.tokens, 0))
  return (
    <>
      <h3>Context: {shortCount(used)}{max > 0 && ` of ${shortCount(max)}`}{breakdown.estimated && ' (about)'}</h3>
      {model !== null && <p className="on">Model: {model}</p>}
      <div className="stack" aria-hidden="true">
        {categories.map(category => category.tokens > 0 && (
          <span key={category.id} className="part" style={{ flexGrow: category.tokens }} title={`${category.label} ${shortCount(category.tokens)}`} />
        ))}
        {free > 0 && <span className="free" style={{ flexGrow: free }} title={`Free ${shortCount(free)}`} />}
      </div>
      <ol>
        {categories.map(category => <li key={category.id}><span>{category.label}</span><span className="n">{shortCount(category.tokens)}</span></li>)}
        {max > 0 && <li className="free"><span>Free</span><span className="n">{shortCount(free)}</span></li>}
      </ol>
      {categories.length === 0 && <p>Hermes has not measured this chat yet.</p>}
    </>
  )
}

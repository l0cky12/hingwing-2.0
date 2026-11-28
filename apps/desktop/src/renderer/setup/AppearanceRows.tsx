import { useEffect, useId, useRef, useState } from 'react'
import {
  CHAT_WIDTHS, CONTRAST, DEFAULT_APPEARANCE, FONT_ROLES, fontChoices, isDefaultRole, MOTION, ROLE_ORDER, WIDTH_ORDER,
  type Appearance, type ChatWidth, type FontRole
} from '../../appearance'
import { run, useTopic } from '../store'
import { line } from './ConnectionCard'
import type { RowId } from './settings-view'

const Undo = () => <svg {...line(14, 2)}><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>

interface LocalFont { readonly family: string }
declare global {
  interface Window { queryLocalFonts?: () => Promise<readonly LocalFont[]> }
}

function useInstalledFamilies(): readonly string[] {
  const [families, setFamilies] = useState<readonly string[]>([])
  useEffect(() => {
    let current = true
    window.queryLocalFonts?.().then(fonts => {
      if (current) setFamilies(fonts.map(font => font.family))
    }, () => {})
    return () => { current = false }
  }, [])
  return families
}

type Pick = (change: (from: Appearance) => Appearance) => void

function useAppearancePicks(): readonly [Appearance, Pick] {
  const held = useTopic('appearance') ?? DEFAULT_APPEARANCE
  const [sent, setSent] = useState<Appearance | null>(null)
  if (sent !== null && JSON.stringify(sent) === JSON.stringify(held)) setSent(null)
  const shown = sent ?? held
  const latest = useRef(shown)
  latest.current = shown
  const pick: Pick = change => {
    const next = change(latest.current)
    latest.current = next
    setSent(next)
    void run({ do: 'setAppearance', appearance: next })
  }
  return [shown, pick]
}

function Reset({ label, onReset }: { readonly label: string; readonly onReset: () => void }) {
  return <button type="button" className="reset" aria-label={label} title={label} onClick={onReset}><Undo /></button>
}

function RowText({ id, label, desc, reset }: { readonly id: string; readonly label: string; readonly desc: string; readonly reset: (() => void) | null }) {
  return (
    <div className="text">
      <p className="label"><span id={id}>{label}</span>{reset !== null && <Reset label={`Reset ${label.toLowerCase()}`} onReset={reset} />}</p>
      <p className="desc" id={`${id}-desc`}>{desc}</p>
    </div>
  )
}

function Sample({ role }: { readonly role: FontRole }) {
  const { sample } = FONT_ROLES[role]
  if (role === 'interface' || role === 'prompt') return <p className="sample" data-role={role} aria-hidden="true">{sample}</p>
  return (
    <pre className="sample" data-role={role} aria-hidden="true">
      {sample.split('\n').map((text, at) => <span key={at} className={text.startsWith('+') ? 'add' : text.startsWith('-') ? 'del' : undefined}>{text}{'\n'}</span>)}
    </pre>
  )
}

function FontRow({ role, appearance, installed, hidden, pick }: { readonly role: FontRole; readonly appearance: Appearance; readonly installed: readonly string[]; readonly hidden: boolean; readonly pick: Pick }) {
  const id = useId()
  const spec = FONT_ROLES[role]
  const font = appearance.fonts[role]
  const wrap = spec.wrap
  const setFont = (change: Partial<typeof font>) => pick(from => ({ ...from, fonts: { ...from.fonts, [role]: { ...from.fonts[role], ...change } } }))
  const reset = () => pick(from => ({
    ...from, fonts: { ...from.fonts, [role]: DEFAULT_APPEARANCE.fonts[role] }, ...(wrap === null ? {} : { wrap: { ...from.wrap, [wrap]: DEFAULT_APPEARANCE.wrap[wrap] } })
  }))
  const sizes = Array.from({ length: spec.max - spec.min + 1 }, (_, at) => spec.min + at)
  return (
    <div className="row sampled" hidden={hidden}>
      <RowText id={id} label={spec.label} desc={spec.desc} reset={isDefaultRole(appearance, role) ? null : reset} />
      <div className="control">
        <select aria-label={spec.label} aria-describedby={`${id}-desc`} value={font.family ?? ''} onChange={event => setFont({ family: event.target.value === '' ? null : event.target.value })}>
          <option value="">Default ({spec.face})</option>
          {fontChoices(installed, font.family).map(family => <option key={family} value={family}>{family}</option>)}
        </select>
        <select aria-label={`${spec.label} size`} value={font.size} onChange={event => setFont({ size: Number(event.target.value) })}>
          {sizes.map(size => <option key={size} value={size}>{size} px</option>)}
        </select>
      </div>
      <Sample role={role} />
      {wrap !== null && (
        <label className="sample-wrap">
          <input type="checkbox" role="switch" checked={appearance.wrap[wrap]} onChange={event => { const on = event.target.checked; pick(from => ({ ...from, wrap: { ...from.wrap, [wrap]: on } })) }} />
          Wrap long {role} lines
        </label>
      )}
    </div>
  )
}

function Slider({ label, desc, min, max, step, value, unit, fallback, hidden, onPick }: {
  readonly label: string
  readonly desc: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly value: number
  readonly unit: (value: number) => string
  readonly fallback: number
  readonly hidden: boolean
  readonly onPick: (value: number) => void
}) {
  const id = useId()
  return (
    <div className="row" hidden={hidden}>
      <RowText id={id} label={label} desc={desc} reset={value === fallback ? null : () => onPick(fallback)} />
      <div className="control">
        <output className="readout" htmlFor={`${id}-range`}>{unit(value)}</output>
        <input
          id={`${id}-range`} type="range" min={min} max={max} step={step} value={value} aria-labelledby={id} aria-describedby={`${id}-desc`} aria-valuetext={unit(value)}
          onChange={event => onPick(Number(event.target.value))}
        />
      </div>
    </div>
  )
}

function SwitchRow({ label, desc, checked, hidden, onPick }: { readonly label: string; readonly desc: string; readonly checked: boolean; readonly hidden: boolean; readonly onPick: (on: boolean) => void }) {
  const id = useId()
  return (
    <div className="row" hidden={hidden}>
      <RowText id={id} label={label} desc={desc} reset={null} />
      <div className="control">
        <input type="checkbox" role="switch" aria-labelledby={id} aria-describedby={`${id}-desc`} checked={checked} onChange={event => onPick(event.target.checked)} />
      </div>
    </div>
  )
}

function SelectRow<V extends string>({ label, desc, value, options, hidden, onPick }: {
  readonly label: string
  readonly desc: string
  readonly value: V
  readonly options: readonly { readonly value: V; readonly label: string }[]
  readonly hidden: boolean
  readonly onPick: (value: V) => void
}) {
  const id = useId()
  return (
    <div className="row" hidden={hidden}>
      <RowText id={id} label={label} desc={desc} reset={null} />
      <div className="control">
        <select aria-labelledby={id} aria-describedby={`${id}-desc`} value={value} onChange={event => onPick(options.find(option => option.value === event.target.value)!.value)}>
          {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
    </div>
  )
}

const WIDTHS = WIDTH_ORDER.map(width => ({ value: width, label: CHAT_WIDTHS[width].label }))

export function AppearanceRows({ off }: { readonly off: (row: RowId) => boolean }) {
  const [appearance, pick] = useAppearancePicks()
  const installed = useInstalledFamilies()
  return (
    <>
      {ROLE_ORDER.map(role => <FontRow key={role} role={role} appearance={appearance} installed={installed} hidden={off(`font-${role}`)} pick={pick} />)}
      <SelectRow<ChatWidth>
        label="Chat width" desc="How wide messages and the composer can grow in a wide window." value={appearance.chatWidth} options={WIDTHS} hidden={off('chat-width')}
        onPick={chatWidth => pick(from => ({ ...from, chatWidth }))}
      />
      <Slider
        label="Contrast" desc="Make secondary text and dividing lines stronger or softer." min={CONTRAST.min} max={CONTRAST.max} step={5} value={appearance.contrast} unit={value => `${value}%`}
        fallback={CONTRAST.default} hidden={off('contrast')} onPick={contrast => pick(from => ({ ...from, contrast }))}
      />
      <SwitchRow
        label="Render math" desc="Typeset formulas such as $x^2$ in replies. When off, replies show the formula as written." checked={appearance.math} hidden={off('math')}
        onPick={math => pick(from => ({ ...from, math }))}
      />
      <Slider
        label="Animations" desc="How long menus fade and markers pulse. 0 turns animations off." min={MOTION.min} max={MOTION.max} step={10} value={appearance.motionMs} unit={value => `${value} ms`}
        fallback={MOTION.default} hidden={off('motion')} onPick={motionMs => pick(from => ({ ...from, motionMs }))}
      />
    </>
  )
}

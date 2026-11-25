import type { CommandOutcome, PetChoice } from '@highwing/hermes/domain'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { PictureFile } from '../../ipc-contract'
import { DEFAULT_LOOK, FACE_COLOR_NAMES, FACE_COLORS, FACE_SHAPES, faceSvg, lookWords, shapeFor, titleOf, type Face, type FaceColor, type FaceShape, type Look } from './look'
import { blobUrlOf } from './pictures'

/** What the picker asks Hermes and main for. */
export interface LookCalls {
  readonly canGenerate: () => Promise<CommandOutcome<boolean>>
  readonly generate: (prompt: string) => Promise<CommandOutcome<string>>
  readonly choose: () => Promise<CommandOutcome<PictureFile>>
  readonly pets: () => Promise<CommandOutcome<readonly PetChoice[]>>
  readonly petPicture: (pet: PetChoice) => Promise<CommandOutcome<string | null>>
}

interface LookPickerProps {
  readonly look: Look
  /** The typed name, which an Auto shape follows. */
  readonly name: string
  readonly calls: LookCalls
  readonly onLook: (look: Look) => void
}

const TABS = [['shape', 'Shape'], ['generate', 'Generate'], ['upload', 'Upload'], ['pet', 'Pet']] as const
type Tab = typeof TABS[number][0]

/** `none`: Hermes has no image model. `busy`: a picture is being drawn. `words`: why the last ask failed. */
type Drawing = { readonly at: 'unknown' | 'checking' | 'none' | 'ready' | 'busy'; readonly words: string | null }
type PetList = { readonly at: 'unread' | 'reading' } | { readonly at: 'read'; readonly pets: readonly PetChoice[] } | { readonly at: 'refused'; readonly words: string }
/** A pet's idle frame: `loading`, or the picture, null when Hermes has none. */
type Thumb = 'loading' | string | null

const SHOWN_PETS = 24
const HOW = 'Click it to pick a shape, generate a picture, upload one or choose a pet.'

const icon = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
const Pencil = () => <svg {...icon} aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
const Dice = () => <svg {...icon} aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M9 9h.01M15 15h.01M15 9h.01M9 15h.01" /></svg>
const Spark = () => <svg {...icon} aria-hidden="true"><path d="m12 3 2 5 5 2-5 2-2 5-2-5-5-2 5-2z" /></svg>

/** A blob URL for a data URL, revoked when the data URL changes or the component goes. */
function useBlobUrl(data: string | null): string | null {
  const url = useMemo(() => (data === null ? null : blobUrlOf(data)), [data])
  useEffect(() => () => {
    if (url !== null) URL.revokeObjectURL(url)
  }, [url])
  return url
}

function FaceArt({ shape, color, size }: { readonly shape: FaceShape; readonly color: FaceColor; readonly size: number }) {
  // The markup is built from the fixed shape and color tables alone, never from anything typed or received.
  return <span className="look-face" dangerouslySetInnerHTML={{ __html: faceSvg(shape, color, size) }} />
}

export function LookArt({ look, name, size }: { readonly look: Look; readonly name: string; readonly size: number }) {
  const url = useBlobUrl(look.from === 'face' ? null : look.picture)
  if (look.from === 'face') return <FaceArt shape={shapeFor(look.shape, name)} color={look.color} size={size} />
  return url === null ? null : <img className={`look-picture${look.from === 'pet' ? ' pet' : ''}`} src={url} alt="" width={size} height={size} />
}

/** A pet is picked by its picture, so a tile is disabled until Hermes sends one, and stays so when Hermes has none. */
function PetTile({ pet, thumb = 'loading', pressed, onPick }: { readonly pet: PetChoice; readonly thumb: Thumb | undefined; readonly pressed: boolean; readonly onPick: (picture: string) => void }) {
  const picture = thumb === 'loading' ? null : thumb
  const url = useBlobUrl(picture)
  return (
    <button
      type="button" className="look-pet" aria-pressed={pressed} aria-busy={thumb === 'loading' || undefined} disabled={picture === null}
      title={thumb === null ? `Hermes has no picture of ${pet.name}` : pet.name} onClick={() => { if (picture !== null) onPick(picture) }}
    >
      <span className="look-pet-art">{url !== null && <img src={url} alt="" width={40} height={40} />}</span>
      <span className="look-pet-name">{pet.name}</span>
    </button>
  )
}

const matchesOf = (pets: readonly PetChoice[], query: string) => {
  const words = query.trim().toLowerCase()
  return pets.filter(pet => words === '' || pet.name.toLowerCase().includes(words) || pet.slug.toLowerCase().includes(words)).slice(0, SHOWN_PETS)
}

export function LookPicker({ look, name, calls, onLook }: LookPickerProps) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('shape')
  const [face, setFace] = useState<Face>(look.from === 'face' ? look : DEFAULT_LOOK)
  const [prompt, setPrompt] = useState('')
  const [drawing, setDrawing] = useState<Drawing>({ at: 'unknown', words: null })
  const [upload, setUpload] = useState<{ readonly busy: boolean; readonly words: string | null }>({ busy: false, words: null })
  const [petList, setPetList] = useState<PetList>({ at: 'unread' })
  const [query, setQuery] = useState('')
  const [thumbs, setThumbs] = useState<ReadonlyMap<string, Thumb>>(new Map())
  const root = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const ids = useId()

  const close = (refocus: boolean) => {
    setOpen(false)
    if (refocus) button.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    pop.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
    // Capturing on the document sees Escape before the dialog does, so it closes only this.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      close(true)
    }
    const onDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node && root.current?.contains(event.target))) close(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [open])

  const matches = petList.at === 'read' ? matchesOf(petList.pets, query) : []
  useEffect(() => {
    const unread = matches.filter(pet => !thumbs.has(pet.slug))
    if (unread.length === 0) return
    setThumbs(held => new Map([...held, ...unread.map(pet => [pet.slug, 'loading'] as const)]))
    for (const pet of unread) {
      void calls.petPicture(pet).then(outcome => setThumbs(held => new Map(held).set(pet.slug, outcome.ok ? outcome.value : null)))
    }
  }, [matches.map(pet => pet.slug).join('\n')])

  const show = (next: Tab) => {
    setTab(next)
    if (next === 'generate' && (drawing.at === 'unknown' || drawing.at === 'none')) {
      setDrawing({ at: 'checking', words: null })
      void calls.canGenerate().then(outcome => setDrawing(outcome.ok ? { at: outcome.value ? 'ready' : 'none', words: null } : { at: 'unknown', words: outcome.refusal.message }))
    }
    if (next === 'pet' && (petList.at === 'unread' || petList.at === 'refused')) {
      setPetList({ at: 'reading' })
      void calls.pets().then(outcome => setPetList(outcome.ok ? { at: 'read', pets: outcome.value } : { at: 'refused', words: outcome.refusal.message }))
    }
  }
  const onTabKey = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    if (step === undefined) return
    event.preventDefault()
    const next = TABS[(TABS.findIndex(([held]) => held === tab) + step + TABS.length) % TABS.length]![0]
    show(next)
    document.getElementById(`${ids}-tab-${next}`)?.focus()
  }

  const pickFace = (more: Partial<Face>) => {
    const next = { ...face, ...more }
    setFace(next)
    onLook(next)
  }
  const surprise = () => {
    const pick = <T,>(items: readonly T[]) => items[Math.floor(Math.random() * items.length)] as T
    const shapes = FACE_SHAPES.filter(shape => shape !== face.shape)
    pickFace({ shape: pick(shapes), color: pick(FACE_COLOR_NAMES.filter(color => color !== face.color)) })
  }
  const backToFace = () => {
    onLook(face)
    show('shape')
  }
  const generate = async () => {
    setDrawing({ at: 'busy', words: null })
    const outcome = await calls.generate(prompt.trim())
    setDrawing({ at: 'ready', words: outcome.ok ? null : outcome.refusal.message })
    if (outcome.ok) onLook({ from: 'generate', picture: outcome.value })
  }
  const choose = async () => {
    setUpload({ busy: true, words: null })
    const outcome = await calls.choose()
    setUpload({ busy: false, words: outcome.ok ? null : outcome.refusal.message })
    if (outcome.ok && outcome.value !== 'cancelled') onLook({ from: 'upload', picture: outcome.value })
  }

  const shapeInstead = look.from !== 'face' && <button type="button" className="look-reset" onClick={backToFace}>Use a shape instead</button>
  const panels: { readonly [T in Tab]: () => ReactNode } = {
    shape: () => (
      <>
        <div className="look-shapes" role="group" aria-label="Shape">
          <button type="button" className="look-shape look-auto" aria-pressed={look.from === 'face' && look.shape === 'auto'} onClick={() => pickFace({ shape: 'auto' })}>Auto</button>
          {FACE_SHAPES.map(shape => (
            <button key={shape} type="button" className="look-shape" aria-label={titleOf(shape)} title={titleOf(shape)} aria-pressed={look.from === 'face' && look.shape === shape} onClick={() => pickFace({ shape })}>
              <FaceArt shape={shape} color={face.color} size={32} />
            </button>
          ))}
        </div>
        <div className="look-tones">
          <div className="look-colors" role="group" aria-label="Color">
            {FACE_COLOR_NAMES.map(color => (
              <button
                key={color} type="button" className="look-color" aria-label={titleOf(color)} title={titleOf(color)}
                aria-pressed={look.from === 'face' && look.color === color} style={{ background: FACE_COLORS[color] }} onClick={() => pickFace({ color })}
              />
            ))}
          </div>
          <button type="button" className="look-quiet" onClick={surprise}><Dice />Surprise me</button>
        </div>
      </>
    ),
    generate: () => (
      <>
        {drawing.at === 'checking' && <p className="look-hint" role="status">Checking for an image model…</p>}
        {drawing.at === 'none' && <p className="look-note">This Hermes has no image model. Turn one on with <code>hermes tools</code>.</p>}
        {(drawing.at === 'ready' || drawing.at === 'busy') && (
          <>
            <textarea
              aria-label="Describe the picture" rows={2} value={prompt} placeholder="Describe the picture, like “a cheerful robot reading the news”"
              onChange={event => setPrompt(event.target.value)}
            />
            <div className="look-draw">
              <p className="look-hint">Hermes draws it with its image model.</p>
              <button type="button" className="look-quiet" disabled={prompt.trim() === '' || drawing.at === 'busy'} aria-busy={drawing.at === 'busy' || undefined} onClick={() => void generate()}>
                <Spark />{drawing.at === 'busy' ? 'Generating…' : 'Generate'}
              </button>
            </div>
            {drawing.at === 'busy' && <p className="look-hint" role="status">Hermes is drawing it. This can take a minute.</p>}
          </>
        )}
        {drawing.words !== null && <p className="form-refused" role="alert">{drawing.words}</p>}
        {shapeInstead}
      </>
    ),
    upload: () => (
      <>
        <div className="look-draw">
          <button type="button" className="look-quiet" disabled={upload.busy} aria-busy={upload.busy || undefined} onClick={() => void choose()}>Choose a picture…</button>
          <p className="look-hint">PNG, JPEG or WebP, 2 MB or less.</p>
        </div>
        {upload.words !== null && <p className="form-refused" role="alert">{upload.words}</p>}
        {shapeInstead}
      </>
    ),
    pet: () => (
      <>
        {/* Enter in the search box would otherwise submit the New bot form. */}
        <input
          aria-label="Search pets" placeholder="Search pets" value={query} autoComplete="off" spellCheck={false}
          onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }}
        />
        {petList.at === 'reading' && <p className="look-hint" role="status">Loading pets…</p>}
        {petList.at === 'refused' && <p className="form-refused" role="alert">{petList.words}</p>}
        {petList.at === 'read' && petList.pets.length === 0 && <p className="look-note">This Hermes lists no pets.</p>}
        {petList.at === 'read' && petList.pets.length > 0 && matches.length === 0 && <p className="look-note">No pets match “{query.trim()}”.</p>}
        {matches.length > 0 && (
          <div className="look-pets" role="group" aria-label="Pets">
            {matches.map(pet => (
              <PetTile
                key={pet.slug} pet={pet} thumb={thumbs.get(pet.slug)} pressed={look.from === 'pet' && look.slug === pet.slug}
                onPick={picture => onLook({ from: 'pet', slug: pet.slug, name: pet.name, picture })}
              />
            ))}
          </div>
        )}
        {shapeInstead}
      </>
    )
  }

  return (
    <div
      className="look" ref={root}
      onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}
    >
      <div className="look-row">
        <button
          ref={button} type="button" className="look-button" aria-label="Change picture" aria-describedby={`${ids}-words`}
          aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${ids}-pop` : undefined} onClick={() => setOpen(held => !held)}
        >
          <LookArt look={look} name={name} size={64} />
          <span className="look-badge"><Pencil /></span>
        </button>
        <div className="look-words" id={`${ids}-words`}>
          <strong>{lookWords(look, name)}</strong>
          <span>{HOW}</span>
        </div>
      </div>
      {open && (
        <div className="look-pop" role="dialog" aria-label="Bot picture" id={`${ids}-pop`} ref={pop}>
          <div className="look-tabs" role="tablist" aria-label="Picture from" onKeyDown={onTabKey}>
            {TABS.map(([key, label]) => (
              <button
                key={key} id={`${ids}-tab-${key}`} type="button" role="tab" aria-selected={tab === key} aria-controls={`${ids}-panel`}
                tabIndex={tab === key ? 0 : -1} onClick={() => show(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="look-panel" role="tabpanel" id={`${ids}-panel`} aria-labelledby={`${ids}-tab-${tab}`}>{panels[tab]()}</div>
        </div>
      )}
    </div>
  )
}

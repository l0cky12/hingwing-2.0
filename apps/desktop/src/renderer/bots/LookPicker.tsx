import type { CommandOutcome, PetChoice } from '@highwing/hermes/domain'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { PictureFile } from '../../ipc-contract'
import { DEFAULT_LOOK, FACE_COLOR_NAMES, FACE_COLORS, FACE_SHAPES, faceSvg, lookWords, shapeFor, surpriseFor, titleOf, type Face, type FaceColor, type FaceShape, type Look } from './look'
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
  /** True while a picture is being drawn that will become the look. A pick since lets it go, and this turns false. */
  readonly onDrawing: (drawing: boolean) => void
}

const TABS = [['shape', 'Shape'], ['generate', 'Generate'], ['upload', 'Upload'], ['pet', 'Pet']] as const
type Tab = typeof TABS[number][0]

/**
 * `none`: Hermes has no image model. `busy`: Hermes is drawing, and `wanted` until the user picks something else, since a
 * newer pick wins over the picture. `words`: why the last ask failed.
 */
type Drawing =
  | { readonly at: 'unknown' | 'checking' | 'none' | 'ready'; readonly words: string | null }
  | { readonly at: 'busy'; readonly wanted: boolean }
type PetList = { readonly at: 'unread' | 'reading' } | { readonly at: 'read'; readonly pets: readonly PetChoice[] } | { readonly at: 'refused'; readonly words: string }
/** A pet's idle frame. `refused`: the ask failed, so it is made again when the tile is next shown. `picture`: null when Hermes has none. */
type Thumb = { readonly at: 'loading' | 'refused' } | { readonly at: 'read'; readonly picture: string | null }

const SHOWN_PETS = 24
const SHOWN_SHARE = 0.1
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

interface PetTileProps {
  readonly pet: PetChoice
  readonly thumb: Thumb | undefined
  readonly pressed: boolean
  /** Called each time the tile scrolls into view. */
  readonly onShown: () => void
  readonly onPick: (picture: string) => void
}

const titleOfTile = (pet: PetChoice, thumb: Thumb | undefined) =>
  thumb?.at === 'refused' ? `Highwing couldn't load ${pet.name}'s picture` : thumb?.at === 'read' && thumb.picture === null ? `Hermes has no picture of ${pet.name}` : pet.name

/** A pet is picked by its picture, so a tile is disabled until Hermes sends one, and stays so when Hermes has none. */
export function PetTile({ pet, thumb, pressed, onShown, onPick }: PetTileProps) {
  const picture = thumb?.at === 'read' ? thumb.picture : null
  const url = useBlobUrl(picture)
  const tile = useRef<HTMLButtonElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    // A tile whose edge only touches the grid's counts as intersecting, so a share of it in view is what counts as shown.
    const watch = new IntersectionObserver(entries => setShown((entries.at(-1)?.intersectionRatio ?? 0) >= SHOWN_SHARE), { threshold: SHOWN_SHARE })
    if (tile.current !== null) watch.observe(tile.current)
    return () => watch.disconnect()
  }, [])
  useEffect(() => {
    if (shown) onShown()
  }, [shown])
  return (
    <button
      ref={tile} type="button" className="look-pet" aria-pressed={pressed} aria-busy={thumb === undefined || thumb.at === 'loading' || undefined}
      disabled={picture === null} title={titleOfTile(pet, thumb)} onClick={() => { if (picture !== null) onPick(picture) }}
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

export function LookPicker({ look, name, calls, onLook, onDrawing }: LookPickerProps) {
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
  /** The drawing whose picture becomes the look when it lands, until a pick lets it go. */
  const awaited = useRef<symbol | null>(null)
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
  // Hermes reads thumbs on a small pool shared with every slow call, so only a tile the user can see asks for its own.
  const readThumb = (pet: PetChoice) => {
    const held = thumbs.get(pet.slug)
    if (held !== undefined && held.at !== 'refused') return
    setThumbs(now => new Map(now).set(pet.slug, { at: 'loading' }))
    void calls.petPicture(pet).then(outcome => setThumbs(now => new Map(now).set(pet.slug, outcome.ok ? { at: 'read', picture: outcome.value } : { at: 'refused' })))
  }

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

  const take = (next: Look) => {
    if (awaited.current !== null) {
      awaited.current = null
      setDrawing({ at: 'busy', wanted: false })
      onDrawing(false)
    }
    onLook(next)
  }
  const pickFace = (more: Partial<Face>) => {
    const next = { ...face, ...more }
    setFace(next)
    take(next)
  }
  // The button that was pressed leaves with its panel, so focus goes to the tab whose panel takes its place.
  const backToFace = () => {
    take(face)
    show('shape')
    document.getElementById(`${ids}-tab-shape`)?.focus()
  }
  const generate = async () => {
    const mine = Symbol('drawing')
    awaited.current = mine
    setDrawing({ at: 'busy', wanted: true })
    onDrawing(true)
    const outcome = await calls.generate(prompt.trim())
    const wanted = awaited.current === mine
    setDrawing({ at: 'ready', words: wanted && !outcome.ok ? outcome.refusal.message : null })
    if (!wanted) return
    awaited.current = null
    onDrawing(false)
    if (outcome.ok) onLook({ from: 'generate', picture: outcome.value })
  }
  const choose = async () => {
    setUpload({ busy: true, words: null })
    const outcome = await calls.choose()
    setUpload({ busy: false, words: outcome.ok ? null : outcome.refusal.message })
    if (outcome.ok && outcome.value !== 'cancelled') take({ from: 'upload', picture: outcome.value })
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
          <button type="button" className="look-quiet" onClick={() => pickFace(surpriseFor(face, name))}><Dice />Surprise me</button>
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
            {drawing.at === 'busy' && (
              <p className="look-hint" role="status">
                {drawing.wanted ? 'Hermes is drawing it. This can take a minute.' : "Hermes is still drawing it. You've picked another look since, so it won't be used."}
              </p>
            )}
          </>
        )}
        {drawing.at !== 'busy' && drawing.words !== null && <p className="form-refused" role="alert">{drawing.words}</p>}
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
                key={pet.slug} pet={pet} thumb={thumbs.get(pet.slug)} pressed={look.from === 'pet' && look.slug === pet.slug} onShown={() => readThumb(pet)}
                onPick={picture => take({ from: 'pet', slug: pet.slug, name: pet.name, picture })}
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

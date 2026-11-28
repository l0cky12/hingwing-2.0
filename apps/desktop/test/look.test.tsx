import { FACE_COLOR_NAMES, FACE_SHAPES, type ModelMenu } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BotForm } from '../src/renderer/bots/BotForm'
import { EMPTY_DRAFT } from '../src/renderer/bots/bot-form'
import { DEFAULT_LOOK, faceOf, faceSvg, lookWords, shapeFor, surpriseFor } from '../src/renderer/bots/look'
import { LookPicker, pendingLook, PetTile, thumbOf, type LookCalls } from '../src/renderer/bots/LookPicker'
import { NewBotForm } from '../src/renderer/bots/NewBotForm'
import { NO_PET } from './support/bots'

const NAMES = ['Rae', 'Ada', 'Sam', 'Research', 'Emu', 'Timothy', 'highwing', 'Pip', 'Ledger', 'Juno']
const PICTURE = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`
const CALLS: LookCalls = {
  canGenerate: async () => ({ ok: true, value: true }), generate: async () => ({ ok: true, value: PICTURE }), choose: async () => ({ ok: true, value: 'cancelled' }),
  pets: async () => ({ ok: true, value: [] }), petPicture: async () => ({ ok: true, value: null })
}
const MODELS: ModelMenu = { options: [], fallback: null }
const attr = (tag: string, name: string) => new RegExp(` ${name}="([^"]*)"`).exec(tag)?.[1]

describe('an Auto shape', () => {
  it('is the same for a name however it is typed, as Hermes keeps one id for it', () => {
    for (const name of NAMES) {
      expect(shapeFor('auto', ` ${name.toUpperCase()} `), name).toBe(shapeFor('auto', name))
      expect(shapeFor('auto', name), 'and again').toBe(shapeFor('auto', name))
    }
  })

  it('differs across names', () => {
    expect(new Set(NAMES.map(name => shapeFor('auto', name))).size).toBeGreaterThan(4)
  })

  it('gives way to a shape the user picked', () => {
    for (const name of NAMES) expect(shapeFor('pill', name)).toBe('pill')
  })
})

describe('Surprise me', () => {
  const draws = Array.from({ length: 24 }, (_, at) => at / 24)

  it('picks a shape and a color other than the ones the face shows, Auto included', () => {
    for (const name of NAMES) {
      for (const face of [DEFAULT_LOOK, { ...DEFAULT_LOOK, shape: 'pill' as const, color: 'coral' as const }]) {
        for (const draw of draws) {
          const next = surpriseFor(face, name, () => draw)
          expect(next.shape, `${name} ${face.shape} ${draw}`).not.toBe(shapeFor(face.shape, name))
          expect(next.color, `${name} ${face.color} ${draw}`).not.toBe(face.color)
        }
      }
    }
  })

  it('can land on every other shape and color', () => {
    const faces = draws.map(draw => surpriseFor(DEFAULT_LOOK, 'Rae', () => draw))
    expect(new Set(faces.map(face => face.shape)).size).toBe(FACE_SHAPES.length - 1)
    expect(new Set(faces.map(face => face.color)).size).toBe(FACE_COLOR_NAMES.length - 1)
  })
})

describe('a face', () => {
  it('comes in 12 shapes and 12 colors, each drawn with its body and two eyes', () => {
    expect(FACE_SHAPES).toHaveLength(12)
    expect(FACE_COLOR_NAMES).toHaveLength(12)
    for (const shape of FACE_SHAPES) {
      const svg = faceSvg(shape, 'slate', 64)
      expect(svg, shape).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="64" height="64" viewBox="0 0 100 100"/)
      expect(svg.match(/<rect x="(38|54\.5)"/g), shape).toHaveLength(2)
      expect(svg, shape).toContain('#4F7396')
    }
  })

  it('is idle unless a mood is named, so saved pictures and the picker draw what they drew', () => {
    for (const shape of FACE_SHAPES) expect(faceSvg(shape, 'slate', 64, 'idle'), shape).toBe(faceSvg(shape, 'slate', 64))
  })

  it('draws three dots for eyes while working, and two shorter, raised eyes while waiting', () => {
    for (const shape of FACE_SHAPES) {
      const working = faceSvg(shape, 'slate', 64, 'working')
      expect(working.match(/<circle class="face-dot"/g), shape).toHaveLength(3)
      expect(working, shape).not.toMatch(/<rect x="(38|54\.5)"/)
      const waiting = faceSvg(shape, 'slate', 64, 'waiting')
      expect(waiting.match(/<rect x="(38|54\.5)" y="35"[^>]* height="11"/g), shape).toHaveLength(2)
      expect(waiting, shape).not.toBe(faceSvg(shape, 'slate', 64))
    }
  })

  it("gives a bot the shape of its name and a face color for its tone", () => {
    const tones = ['ink', 'slate', 'umber', 'plum', 'olive', 'mauve'] as const
    for (const tone of tones) expect(FACE_COLOR_NAMES, tone).toContain(faceOf({ name: 'Rae', tone }).color)
    expect(faceOf({ name: 'Rae', tone: 'mauve' })).toEqual({ shape: shapeFor('auto', 'Rae'), color: 'rose' })
  })

  it('has dark eyes, and light ones on ink', () => {
    expect(faceSvg('circle', 'coral', 48)).toContain('<g fill="#1F2A26"')
    expect(faceSvg('circle', 'ink', 48)).toContain('<g fill="#F6F7F3"')
  })

  it('rims an ink face in graphite in every shape, so it keeps an edge on a dark page, and no other face', () => {
    for (const shape of FACE_SHAPES) {
      expect(faceSvg(shape, 'ink', 64), shape).toMatch(/^<svg[^>]*><g transform="translate\(50 50\) scale\(1\.08\) translate\(-50 -50\)">.*#7C8783.*<\/g>.*#1F2A26/)
      expect(faceSvg(shape, 'slate', 64), shape).not.toContain('#7C8783')
    }
  })
})

describe('the words for what is picked', () => {
  it('say where the picture comes from', () => {
    expect(lookWords(DEFAULT_LOOK, 'Rae')).toBe(`Slate ${shapeFor('auto', 'Rae')}, picked from the name`)
    expect(lookWords({ from: 'face', shape: 'sparkle', color: 'coral' }, 'Rae')).toBe('Coral sparkle, picked by you')
    expect(lookWords({ from: 'upload', picture: PICTURE }, 'Rae')).toBe('Uploaded picture')
    expect(lookWords({ from: 'generate', picture: PICTURE }, 'Rae')).toBe('Generated picture')
    expect(lookWords({ from: 'pet', slug: 'clover', name: 'Clover', picture: PICTURE }, 'Rae')).toBe('Clover, a pet')
  })
})

describe('the picker, closed', () => {
  const drawn = renderToStaticMarkup(<LookPicker look={DEFAULT_LOOK} name="Rae" calls={CALLS} onLook={() => {}} onWaiting={() => {}} />)
  const button = drawn.match(/<button[^>]*>/)![0]

  it('is one avatar button that says it opens a dialog, and is not open', () => {
    expect(drawn.match(/<button/g)).toHaveLength(1)
    expect([attr(button, 'aria-label'), attr(button, 'aria-haspopup'), attr(button, 'aria-expanded'), attr(button, 'type')]).toEqual(['Change picture', 'dialog', 'false', 'button'])
    expect(drawn).not.toContain('role="dialog"')
  })

  it("draws the name's Auto face and says what is picked and how to change it", () => {
    expect(drawn).toContain(faceSvg(shapeFor('auto', 'Rae'), 'slate', 64))
    expect(drawn).toContain(`Slate ${shapeFor('auto', 'Rae')}, picked from the name`)
    expect(drawn).toContain('Click it to pick a shape, generate a picture, upload one or choose a pet.')
    expect(attr(button, 'aria-describedby')).toBe(/ id="([^"]*-words)"/.exec(drawn)?.[1])
  })

  it('draws a picture as an image in place of the face', () => {
    const pet = renderToStaticMarkup(<LookPicker look={{ from: 'pet', slug: 'clover', name: 'Clover', picture: PICTURE }} name="Rae" calls={CALLS} onLook={() => {}} onWaiting={() => {}} />)
    expect(pet).toMatch(/<img class="look-picture pet" src="blob:/)
    expect(pet).toContain('Clover, a pet')
  })
})

describe('a pet tile', () => {
  const DUNE = { slug: 'dune', name: 'Dune', url: null }
  const tileOf = (thumb: Parameters<typeof PetTile>[0]['thumb']) =>
    renderToStaticMarkup(<PetTile pet={DUNE} thumb={thumb} pressed={false} onShown={() => {}} onPick={() => {}} />).match(/<button[^>]*>/)![0].replaceAll('&#x27;', "'")

  it('is disabled until its picture comes, and says when none came', () => {
    expect([attr(tileOf(undefined), 'title'), tileOf(undefined).includes('disabled')]).toEqual(['Dune', true])
    expect([attr(tileOf({ at: 'missing' }), 'title'), tileOf({ at: 'missing' }).includes('disabled')]).toEqual(['No picture of Dune yet', true])
    expect([attr(tileOf({ at: 'read', picture: PICTURE }), 'title'), tileOf({ at: 'read', picture: PICTURE }).includes('disabled')]).toEqual(['Dune', false])
  })
})

describe("a pet's thumb", () => {
  it('is missing, so asked for again, when the ask fails or Hermes sends none, since a failed fetch or read answers the same', () => {
    expect(thumbOf({ ok: false, refusal: { kind: 'offline', message: 'offline' } })).toEqual({ at: 'missing' })
    expect(thumbOf({ ok: true, value: null })).toEqual({ at: 'missing' })
    expect(thumbOf({ ok: true, value: PICTURE })).toEqual({ at: 'read', picture: PICTURE })
  })
})

describe('a picture on its way to becoming the look', () => {
  const later = <T,>() => {
    let settle!: (value: T) => void
    let fail!: (error: Error) => void
    const promise = new Promise<T>((resolve, reject) => { settle = resolve; fail = reject })
    return { promise, settle, fail }
  }
  const watched = () => {
    const seen: (string | null)[] = []
    return { seen, pending: pendingLook(source => seen.push(source)) }
  }

  it('is wanted when it lands, and Create waits on it until then', async () => {
    const { seen, pending } = watched()
    const read = later<string>()
    const ran = pending.run('upload', () => read.promise, 'failed')
    expect(seen).toEqual(['upload'])
    read.settle('picture')
    expect(await ran).toEqual({ wanted: true, result: 'picture' })
    expect(seen).toEqual(['upload', null])
  })

  it('is not wanted once a pick lets it go, and Create stops waiting at the pick', async () => {
    const { seen, pending } = watched()
    const read = later<string>()
    const ran = pending.run('upload', () => read.promise, 'failed')
    pending.letGo()
    expect(seen).toEqual(['upload', null])
    read.settle('picture')
    expect(await ran).toEqual({ wanted: false, result: 'picture' })
    expect(seen).toEqual(['upload', null])
  })

  it('is not wanted once a newer one starts, which Create waits on instead', async () => {
    const { seen, pending } = watched()
    const [drawn, read] = [later<string>(), later<string>()]
    const drawing = pending.run('generate', () => drawn.promise, 'failed')
    const reading = pending.run('upload', () => read.promise, 'failed')
    drawn.settle('drawn')
    expect(await drawing).toEqual({ wanted: false, result: 'drawn' })
    expect(seen).toEqual(['generate', 'upload'])
    read.settle('read')
    expect(await reading).toEqual({ wanted: true, result: 'read' })
    expect(seen).toEqual(['generate', 'upload', null])
  })

  it('settles as failed when its call throws, so Create stops waiting', async () => {
    const { seen, pending } = watched()
    const drawn = later<string>()
    const ran = pending.run('generate', () => drawn.promise, 'failed')
    drawn.fail(new Error('No handler registered for highwing:run'))
    expect(await ran).toEqual({ wanted: true, result: 'failed' })
    expect(seen).toEqual(['generate', null])
    expect(await pending.run('upload', () => { throw new Error('gone') }, 'failed')).toEqual({ wanted: true, result: 'failed' })
    expect(seen).toEqual(['generate', null, 'upload', null])
  })
})

describe('the New bot form', () => {
  it('puts the picker above Name, and hands it the draft as typed', () => {
    const drawn = renderToStaticMarkup(
      <BotForm title="New bot" submitLabel="Create" initial={{ ...EMPTY_DRAFT, name: 'Ada' }} problemOf={() => null} models={MODELS} onSubmit={async () => ({ ok: true })} onClose={() => {}}>
        {draft => <LookPicker look={DEFAULT_LOOK} name={draft.name} calls={CALLS} onLook={() => {}} onWaiting={() => {}} />}
      </BotForm>
    )
    expect(drawn.indexOf('Change picture')).toBeLessThan(drawn.indexOf('>Name<'))
    expect(drawn).toContain(faceSvg(shapeFor('auto', 'Ada'), 'slate', 64))
  })

  it('disables Create and says why while it waits on a picture being drawn', () => {
    const form = (waitingFor: string | null) => renderToStaticMarkup(
      <BotForm
        title="New bot" submitLabel="Create" initial={{ ...EMPTY_DRAFT, name: 'Ada' }} problemOf={() => null} models={MODELS} onSubmit={async () => ({ ok: true })}
        onClose={() => {}} waitingFor={waitingFor}
      />
    )
    const create = (drawn: string) => drawn.match(/<button type="submit"[^>]*>/)![0]
    expect(create(form(null))).not.toContain('disabled')
    expect(create(form('Drawing a picture…'))).toContain('disabled')
    expect(form('Drawing a picture…')).toContain('role="status">Drawing a picture…</p>')
  })

  it('starts on the Auto face of a blank name, with every field of the form after it', () => {
    const drawn = renderToStaticMarkup(<NewBotForm problemOf={() => null} models={MODELS} looks={CALLS} pet={NO_PET} onCreate={async () => ({ ok: false, refusal: { kind: 'rejected', message: 'no' } })} onClose={() => {}} />)
    expect(drawn).toContain(faceSvg(shapeFor('auto', ''), 'slate', 64))
    expect(drawn.match(/<label[^>]*>([^<]*)</g)?.map(label => label.replace(/<label[^>]*>|</g, ''))).toEqual(['Name', 'Description', 'Model', 'Persona'])
  })
})

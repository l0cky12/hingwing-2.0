import type { ModelMenu } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BotForm } from '../src/renderer/bots/BotForm'
import { EMPTY_DRAFT } from '../src/renderer/bots/bot-form'
import { DEFAULT_LOOK, FACE_COLOR_NAMES, FACE_SHAPES, faceSvg, lookWords, shapeFor, surpriseFor } from '../src/renderer/bots/look'
import { LookPicker, PetTile, thumbOf, type LookCalls } from '../src/renderer/bots/LookPicker'
import { NewBotForm } from '../src/renderer/bots/NewBotForm'

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

  it('has dark eyes, and light ones on ink', () => {
    expect(faceSvg('circle', 'coral', 48)).toContain('<g fill="#1F2A26"')
    expect(faceSvg('circle', 'ink', 48)).toContain('<g fill="#F6F7F3"')
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
  const drawn = renderToStaticMarkup(<LookPicker look={DEFAULT_LOOK} name="Rae" calls={CALLS} onLook={() => {}} onDrawing={() => {}} />)
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
    const pet = renderToStaticMarkup(<LookPicker look={{ from: 'pet', slug: 'clover', name: 'Clover', picture: PICTURE }} name="Rae" calls={CALLS} onLook={() => {}} onDrawing={() => {}} />)
    expect(pet).toMatch(/<img class="look-picture pet" src="blob:/)
    expect(pet).toContain('Clover, a pet')
  })
})

describe('a pet tile', () => {
  const DUNE = { slug: 'dune', name: 'Dune', url: null }
  const tileOf = (thumb: Parameters<typeof PetTile>[0]['thumb']) =>
    renderToStaticMarkup(<PetTile pet={DUNE} thumb={thumb} pressed={false} onShown={() => {}} onPick={() => {}} />).match(/<button[^>]*>/)![0].replaceAll('&#x27;', "'")

  it('is disabled until its picture comes, and says Hermes has none only when Hermes answered so', () => {
    expect([attr(tileOf(undefined), 'title'), tileOf(undefined).includes('disabled')]).toEqual(['Dune', true])
    expect([attr(tileOf({ at: 'read', picture: null }), 'title'), tileOf({ at: 'read', picture: null }).includes('disabled')]).toEqual(['Hermes has no picture of Dune', true])
    expect([attr(tileOf({ at: 'refused' }), 'title'), tileOf({ at: 'refused' }).includes('disabled')]).toEqual(["Highwing couldn't load Dune's picture", true])
    expect([attr(tileOf({ at: 'read', picture: PICTURE }), 'title'), tileOf({ at: 'read', picture: PICTURE }).includes('disabled')]).toEqual(['Dune', false])
  })
})

describe("a pet's thumb", () => {
  const DUNE = { slug: 'dune', name: 'Dune', url: 'https://cdn.petdex.dev/pets/dune/spritesheet.webp' }
  const BASIL = { slug: 'basil', name: 'Basil', url: null }

  it('is refused when the ask fails, or when Hermes sends none for a pet it fetches, since a failed fetch answers the same', () => {
    expect(thumbOf(DUNE, { ok: false, refusal: { kind: 'offline', message: 'offline' } })).toEqual({ at: 'refused' })
    expect(thumbOf(DUNE, { ok: true, value: null })).toEqual({ at: 'refused' })
    expect(thumbOf(DUNE, { ok: true, value: PICTURE })).toEqual({ at: 'read', picture: PICTURE })
  })

  it('is none only for a pet Hermes holds', () => {
    expect(thumbOf(BASIL, { ok: true, value: null })).toEqual({ at: 'read', picture: null })
    expect(thumbOf(BASIL, { ok: true, value: PICTURE })).toEqual({ at: 'read', picture: PICTURE })
  })
})

describe('the New bot form', () => {
  it('puts the picker above Name, and hands it the draft as typed', () => {
    const drawn = renderToStaticMarkup(
      <BotForm title="New bot" submitLabel="Create" initial={{ ...EMPTY_DRAFT, name: 'Ada' }} problemOf={() => null} models={MODELS} onSubmit={async () => ({ ok: true })} onClose={() => {}}>
        {draft => <LookPicker look={DEFAULT_LOOK} name={draft.name} calls={CALLS} onLook={() => {}} onDrawing={() => {}} />}
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
    const drawn = renderToStaticMarkup(<NewBotForm problemOf={() => null} models={MODELS} looks={CALLS} onCreate={async () => ({ ok: false, refusal: { kind: 'rejected', message: 'no' } })} onClose={() => {}} />)
    expect(drawn).toContain(faceSvg(shapeFor('auto', ''), 'slate', 64))
    expect(drawn.match(/<label[^>]*>([^<]*)</g)?.map(label => label.replace(/<label[^>]*>|</g, ''))).toEqual(['Name', 'Description', 'Model', 'Persona'])
  })
})

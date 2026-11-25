import type { ModelMenu } from '@highwing/hermes/domain'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BotForm } from '../src/renderer/bots/BotForm'
import { EMPTY_DRAFT } from '../src/renderer/bots/bot-form'
import { DEFAULT_LOOK, FACE_COLOR_NAMES, FACE_SHAPES, faceSvg, lookWords, shapeFor } from '../src/renderer/bots/look'
import { LookPicker, type LookCalls } from '../src/renderer/bots/LookPicker'
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
  const drawn = renderToStaticMarkup(<LookPicker look={DEFAULT_LOOK} name="Rae" calls={CALLS} onLook={() => {}} />)
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
    const pet = renderToStaticMarkup(<LookPicker look={{ from: 'pet', slug: 'clover', name: 'Clover', picture: PICTURE }} name="Rae" calls={CALLS} onLook={() => {}} />)
    expect(pet).toMatch(/<img class="look-picture pet" src="blob:/)
    expect(pet).toContain('Clover, a pet')
  })
})

describe('the New bot form', () => {
  it('puts the picker above Name, and hands it the draft as typed', () => {
    const drawn = renderToStaticMarkup(
      <BotForm title="New bot" submitLabel="Create" initial={{ ...EMPTY_DRAFT, name: 'Ada' }} problemOf={() => null} models={MODELS} onSubmit={async () => ({ ok: true })} onClose={() => {}}>
        {draft => <LookPicker look={DEFAULT_LOOK} name={draft.name} calls={CALLS} onLook={() => {}} />}
      </BotForm>
    )
    expect(drawn.indexOf('Change picture')).toBeLessThan(drawn.indexOf('>Name<'))
    expect(drawn).toContain(faceSvg(shapeFor('auto', 'Ada'), 'slate', 64))
  })

  it('starts on the Auto face of a blank name, with every field of the form after it', () => {
    const drawn = renderToStaticMarkup(<NewBotForm problemOf={() => null} models={MODELS} looks={CALLS} onCreate={async () => ({ ok: false, refusal: { kind: 'rejected', message: 'no' } })} onClose={() => {}} />)
    expect(drawn).toContain(faceSvg(shapeFor('auto', ''), 'slate', 64))
    expect(drawn.match(/<label[^>]*>([^<]*)</g)?.map(label => label.replace(/<label[^>]*>|</g, ''))).toEqual(['Name', 'Description', 'Model', 'Persona'])
  })
})

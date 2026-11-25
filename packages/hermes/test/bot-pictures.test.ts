import { describe, expect, it } from 'vitest'
import gallery from '../../../fixtures/pets/gallery.json' with { type: 'json' }
import { GENERATED_MAX_BYTES, PICTURE_MAX_BYTES, pictureDataUrlOf } from '../src/domain/bots'
import { openHermes } from '../src/hub'
import { manualClock } from '../src/testing/clock'
import { scriptedDialer, type Fixture, type Images, type Pets } from '../src/testing/fixture'
import { parseGenerated, parsePetPicture, parsePets } from '../src/wire/parse'
import { BOUND, callsIn, WITH_BOTS } from './support/errand'

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG = [0xff, 0xd8, 0xff, 0xe0]
const base64 = (bytes: readonly number[]) => Buffer.from(bytes).toString('base64')
const PICTURE = `data:image/png;base64,${base64([...PNG, 1, 2, 3, 4])}`
const PETS: Pets = gallery

async function launched(more: Partial<Fixture['header']>, fixture: Fixture = WITH_BOTS) {
  const clock = manualClock()
  const script = scriptedDialer({ ...fixture, header: { ...fixture.header, ...more } }, { clock })
  const hermes = openHermes({ dial: script, clock, client: { name: 'highwing-test', version: '0.0.0' } })
  await clock.advance(0)
  const run: typeof hermes.run = async command => {
    const answer = hermes.run(command)
    await clock.advance(5_000)
    return answer
  }
  return { run, calls: (method: string) => callsIn(script.received).filter(call => call.method === method) }
}
const drawing = (images: Images) => launched({ images })

describe('pictureDataUrlOf', () => {
  it('types a picture by its bytes, whatever type the data URL declares', () => {
    expect(pictureDataUrlOf(PICTURE, PICTURE_MAX_BYTES)).toBe(PICTURE)
    expect(pictureDataUrlOf(`data:image/png;base64,${base64([...JPEG, 1, 2])}`, PICTURE_MAX_BYTES)).toBe(`data:image/jpeg;base64,${base64([...JPEG, 1, 2])}`)
    const webp = base64([...Buffer.from('RIFF'), 4, 0, 0, 0, ...Buffer.from('WEBPVP8 ')])
    expect(pictureDataUrlOf(`data:image/octet;base64,${webp}`, PICTURE_MAX_BYTES)).toBe(`data:image/webp;base64,${webp}`)
  })

  it('takes a picture of exactly the limit and not one byte more, counting the padding', () => {
    const sized = (size: number) => `data:image/png;base64,${Buffer.concat([Buffer.from(PNG), Buffer.alloc(size - PNG.length)]).toString('base64')}`
    for (const limit of [30, 31, 32]) {
      expect(pictureDataUrlOf(sized(limit), limit), `${limit} bytes`).not.toBeNull()
      expect(pictureDataUrlOf(sized(limit + 1), limit), `${limit + 1} bytes`).toBeNull()
    }
    expect(pictureDataUrlOf(sized(PICTURE_MAX_BYTES), PICTURE_MAX_BYTES)).not.toBeNull()
    expect(pictureDataUrlOf(sized(PICTURE_MAX_BYTES + 1), PICTURE_MAX_BYTES)).toBeNull()
  })

  it.each([
    ['a GIF', `data:image/gif;base64,${Buffer.from('GIF89a......').toString('base64')}`],
    ['text that says it is a PNG', `data:image/png;base64,${Buffer.from('just some words').toString('base64')}`],
    ['an SVG', `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`],
    ['a data URL with no base64', `data:image/png,${base64(PNG)}`],
    ['base64 that is not whole', `data:image/png;base64,${base64([...PNG, 1, 2]).replace(/=+$/, '')}`],
    ['base64 with a stray character', `${PICTURE.slice(0, -2)}!=`],
    ['no picture at all', 'data:image/png;base64,'],
    ['a web link', 'https://example.com/a.png'],
    ['not text', 7]
  ])('refuses %s', (_, raw) => {
    expect(pictureDataUrlOf(raw, PICTURE_MAX_BYTES)).toBeNull()
  })
})

describe('parseGenerated', () => {
  it("answers the drawn picture, typed by its bytes, and refuses in Hermes's own words a picture it could not draw", () => {
    expect(parseGenerated({ available: true, success: true, image: '/tmp/a.png', image_data: `data:image/png;base64,${base64([...JPEG, 9])}` }))
      .toEqual({ ok: true, value: `data:image/jpeg;base64,${base64([...JPEG, 9])}` })
    expect(parseGenerated({ available: true, success: false, error: ' out of credit ' })).toEqual({ ok: false, refusal: { kind: 'rejected', message: 'out of credit' } })
    expect(parseGenerated({ available: true, success: false })).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes couldn't draw that picture." } })
  })

  it('refuses a picture Hermes could not send, or one that is no PNG, JPEG or WebP', () => {
    expect(parseGenerated({ available: true, success: true, image: 'https://cdn.example/a.png' }))
      .toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes drew the picture but couldn't send it to Highwing." } })
    expect(parseGenerated({ available: true, success: true, image_data: `data:image/gif;base64,${Buffer.from('GIF89a').toString('base64')}` }))
      .toEqual({ ok: false, refusal: { kind: 'rejected', message: 'Hermes drew a picture that is not a PNG, JPEG or WebP.' } })
  })

  it('takes a picture up to the size asked for, larger than a stored picture may be', () => {
    const big = `data:image/png;base64,${Buffer.concat([Buffer.from(PNG), Buffer.alloc(3_000_000)]).toString('base64')}`
    expect(parseGenerated({ available: true, success: true, image_data: big })).toMatchObject({ ok: true })
    expect(GENERATED_MAX_BYTES).toBeGreaterThan(PICTURE_MAX_BYTES)
  })
})

describe('parsePets', () => {
  it('lists curated pets first, each slug once, named by its display name', () => {
    const pets = parsePets({
      enabled: false,
      pets: [
        { slug: 'pip', displayName: 'Pip', installed: false, spritesheetUrl: 'https://petdex.example/pets/pip.webp' },
        { slug: 'tabby', displayName: 'Tabby', installed: false, spritesheetUrl: 'https://petdex.example/curated/tabby.webp', curated: true },
        { slug: 'pip', displayName: 'Pip again', installed: true },
        { slug: 'mochi', displayName: ' ', installed: true, spritesheetUrl: '' },
        { slug: ' ', displayName: 'Nobody', installed: false }
      ]
    })
    expect(pets).toEqual([
      { slug: 'tabby', name: 'Tabby', url: 'https://petdex.example/curated/tabby.webp' },
      { slug: 'pip', name: 'Pip', url: 'https://petdex.example/pets/pip.webp' },
      { slug: 'mochi', name: 'mochi', url: null }
    ])
  })

  it('keeps no sheet address that is not a web address, and lists nothing from a reply with no pets', () => {
    expect(parsePets({ enabled: true, pets: [{ slug: 'x', displayName: 'X', installed: false, spritesheetUrl: 'file:///etc/passwd' }] })).toEqual([{ slug: 'x', name: 'X', url: null }])
    expect(parsePets({ enabled: false })).toEqual([])
  })

  it('leaves out a pet whose slug would name a folder outside the pets one', () => {
    const rows = ['../../x', '/abs', '..', 'a\\b', 'tabby'].map(slug => ({ slug, displayName: slug, installed: false, spritesheetUrl: '' }))
    expect(parsePets({ enabled: false, pets: rows }).map(pet => pet.slug)).toEqual(['tabby'])
  })
})

describe('parsePetPicture', () => {
  it('answers the idle frame as a PNG data URL, and null for none or for bytes of no picture', () => {
    expect(parsePetPicture({ ok: true, slug: 'tabby', dataUri: PICTURE })).toBe(PICTURE)
    expect(parsePetPicture({ ok: false, slug: 'tabby' })).toBeNull()
    expect(parsePetPicture({ ok: true, slug: 'tabby', dataUri: `data:image/png;base64,${Buffer.from('<html>').toString('base64')}` })).toBeNull()
  })
})

describe('drawing a picture through the hub', () => {
  it('asks whether Hermes has an image model, and reads a Hermes without the call or out of reach as having none', async () => {
    expect(await (await drawing({ available: true })).run({ do: 'canGeneratePicture' })).toEqual({ ok: true, value: true })
    expect(await (await drawing({ available: false })).run({ do: 'canGeneratePicture' })).toEqual({ ok: true, value: false })
    expect(await (await launched({})).run({ do: 'canGeneratePicture' })).toEqual({ ok: true, value: false })
    expect(await (await launched({ images: { available: true } }, BOUND)).run({ do: 'canGeneratePicture' })).toEqual({ ok: true, value: false })
  })

  it('sends the prompt for a square picture of up to 8 MB, and answers its data URL', async () => {
    const { run, calls } = await drawing({ available: true, picture: PICTURE, delay_ms: 1200 })
    expect(await run({ do: 'generatePicture', prompt: 'a cheerful robot' })).toEqual({ ok: true, value: PICTURE })
    expect(calls('image.generate')).toEqual([{ method: 'image.generate', params: { prompt: 'a cheerful robot', aspect_ratio: 'square', max_bytes: 8_000_000 } }])
  })

  it("refuses in Hermes's words when it has no image model or the model fails, and in Highwing's when the picture never came", async () => {
    expect(await (await drawing({ available: false })).run({ do: 'generatePicture', prompt: 'a robot' }))
      .toEqual({ ok: false, refusal: { kind: 'rejected', message: 'No image generation backend configured (run `hermes tools` to enable one).' } })
    expect(await (await drawing({ available: true, error: 'The image provider is out of credit.' })).run({ do: 'generatePicture', prompt: 'a robot' }))
      .toEqual({ ok: false, refusal: { kind: 'rejected', message: 'The image provider is out of credit.' } })
    expect(await (await drawing({ available: true })).run({ do: 'generatePicture', prompt: 'a robot' }))
      .toEqual({ ok: false, refusal: { kind: 'rejected', message: "Hermes drew the picture but couldn't send it to Highwing." } })
    expect(await (await launched({})).run({ do: 'generatePicture', prompt: 'a robot' }))
      .toEqual({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't draw pictures." } })
  })
})

describe('pets through the hub', () => {
  it('lists the curated pets first, and reads a thumb with the sheet address of a pet Hermes does not hold', async () => {
    const { run, calls } = await launched({ pets: PETS })
    const listed = await run({ do: 'pets' })
    const pets = listed.ok ? listed.value : []
    expect(pets).toHaveLength(30)
    expect(pets.slice(0, 8).map(pet => pet.name)).toEqual(['Tabby', 'Clover', 'Bruno', 'Ribbit', 'Hoot', 'Ember', 'Mochi', 'Pebble'])
    const tabby = pets.find(pet => pet.slug === 'tabby')!
    expect(await run({ do: 'petPicture', slug: tabby.slug, url: tabby.url })).toEqual({ ok: true, value: PETS.thumbs.tabby })
    expect(await run({ do: 'petPicture', slug: 'basil', url: null })).toEqual({ ok: true, value: PETS.thumbs.basil })
    expect(await run({ do: 'petPicture', slug: 'dune', url: 'https://petdex.example/pets/dune/spritesheet.webp' })).toEqual({ ok: true, value: null })
    expect(calls('pet.thumb').map(call => call.params)).toEqual([
      { slug: 'tabby', url: 'https://petdex.example/curated/tabby/spritesheet.webp' },
      { slug: 'basil' },
      { slug: 'dune', url: 'https://petdex.example/pets/dune/spritesheet.webp' }
    ])
  })

  it('refuses as unsupported on a Hermes without pets', async () => {
    const { run } = await launched({})
    const refusal = { kind: 'unsupported', message: "This Hermes can't list pets." }
    expect(await run({ do: 'pets' })).toEqual({ ok: false, refusal })
    expect(await run({ do: 'petPicture', slug: 'tabby', url: null })).toEqual({ ok: false, refusal })
  })
})

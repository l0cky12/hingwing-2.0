import type { BotId, CommandOutcome } from '@highwing/hermes/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { givePet, petForNewBot, petPrompt, type PetCalls } from '../src/renderer/bots/pet-picture'

const redraw = vi.hoisted(() => ({ calls: [] as unknown[][], result: (): Promise<string> => Promise.resolve('') }))

vi.mock('../src/renderer/bots/look', () => ({ pictureOf: (...args: unknown[]) => (redraw.calls.push(args), redraw.result()) }))
vi.mock('../src/renderer/store', () => ({ Epoch: {}, runAt: vi.fn() }))
vi.mock('../src/renderer/bots/pictures', () => ({ useClaimPicture: vi.fn(), useForgetPicture: vi.fn() }))

const BOT = 'rae' as BotId
const EPOCH = 7
const ABOUT = { name: ' Rae ', description: ' Keeps the garden notes. ' }
const REDRAWN = 'data:image/png;base64,UkVEUkFXTg=='
const refused = (kind: 'unsupported' | 'rejected', message: string): CommandOutcome<never> => ({ ok: false, refusal: { kind, message } })

const calls = (generate: PetCalls['generate'], save: PetCalls['save'] = async () => ({ ok: true, value: undefined })) => ({ generate: vi.fn(generate), save: vi.fn(save) })

beforeEach(() => {
  redraw.calls = []
  redraw.result = async () => REDRAWN
})

describe('the prompt for a pet picture', () => {
  it('names the bot and its job', () => {
    const prompt = petPrompt(ABOUT)
    expect(prompt).toContain('named Rae,')
    expect(prompt).toContain('whose job is: Keeps the garden notes.')
    expect(prompt).toContain('no text or letters')
  })

  it('leaves the job out when the bot has no description', () => {
    expect(petPrompt({ name: 'Rae', description: '  ' })).not.toContain('job')
  })
})

describe('giving a bot a pet picture', () => {
  it('asks once for a picture, redraws it, and saves the redrawn one', async () => {
    const made = calls(async () => ({ ok: true, value: 'data:image/png;base64,R0VO' }))
    expect(await givePet(made, BOT, ABOUT, EPOCH, () => true)).toEqual({ ok: true, value: undefined })
    expect(made.generate).toHaveBeenCalledOnce()
    expect(made.generate, 'in the epoch it was asked in').toHaveBeenCalledWith(petPrompt(ABOUT), EPOCH)
    expect(redraw.calls).toEqual([[{ from: 'generate', picture: 'data:image/png;base64,R0VO' }, ' Rae ']])
    expect(made.save).toHaveBeenCalledOnce()
    expect(made.save, 'in the epoch it was asked in').toHaveBeenCalledWith(BOT, REDRAWN, EPOCH)
  })

  it.each([
    ['a Hermes that cannot draw', refused('unsupported', "This Hermes can't draw pictures.")],
    ['a Hermes with no image model', refused('rejected', 'No image generation backend configured. Set one up first.')]
  ])('returns the refusal of %s and saves nothing', async (_, refusal) => {
    const made = calls(async () => refusal)
    expect(await givePet(made, BOT, ABOUT, EPOCH, () => true)).toEqual(refusal)
    expect(made.save).not.toHaveBeenCalled()
  })

  it('says it could not draw the picture when the redraw fails, and saves nothing', async () => {
    redraw.result = () => Promise.reject(new Error('bad image'))
    const made = calls(async () => ({ ok: true, value: 'data:image/png;base64,R0VO' }))
    expect(await givePet(made, BOT, ABOUT, EPOCH, () => true)).toEqual(refused('rejected', "Highwing couldn't draw that picture."))
    expect(made.save).not.toHaveBeenCalled()
  })

  it('saves nothing once a newer change to the picture has started', async () => {
    const made = calls(async () => ({ ok: true, value: 'data:image/png;base64,R0VO' }))
    expect(await givePet(made, BOT, ABOUT, EPOCH, () => false)).toEqual({ ok: true, value: undefined })
    expect(made.save).not.toHaveBeenCalled()
  })

  it('returns the refusal when saving fails', async () => {
    const refusal = refused('rejected', 'Hermes would not keep it.')
    const made = calls(async () => ({ ok: true, value: 'data:image/png;base64,R0VO' }), async () => refusal)
    expect(await givePet(made, BOT, ABOUT, EPOCH, () => true)).toEqual(refusal)
  })
})

describe('a new bot', () => {
  const MADE: CommandOutcome<{ readonly bot: BotId }> = { ok: true, value: { bot: BOT } }

  it('gets its pet drawn when its maker left the look alone', () => {
    const draw = vi.fn(async () => ({ ok: true as const, value: undefined }))
    petForNewBot(MADE, true, draw, ABOUT)
    expect(draw).toHaveBeenCalledExactlyOnceWith(BOT, ABOUT)
  })

  it.each([
    ['a look its maker picked', MADE, false],
    ['a refused create', refused('rejected', 'Hermes would not make it.'), true]
  ])('gets no pet for %s', (_, made, keptDefaultLook) => {
    const draw = vi.fn(async () => ({ ok: true as const, value: undefined }))
    petForNewBot(made, keptDefaultLook, draw, ABOUT)
    expect(draw).not.toHaveBeenCalled()
  })
})

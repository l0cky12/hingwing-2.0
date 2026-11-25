import type { BotId, CommandOutcome } from '@highwing/hermes/domain'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const host = vi.hoisted(() => ({
  answer: null as unknown as () => CommandOutcome<string | null>,
  reads: [] as string[],
  effects: new Map<string, readonly unknown[]>()
}))

vi.mock('react', async original => ({
  ...(await original<typeof import('react')>()),
  useContext: () => 0,
  useSyncExternalStore: () => 0,
  useEffect: (effect: () => void, deps: readonly unknown[]) => {
    const key = String(deps[0])
    const last = host.effects.get(key)
    if (last !== undefined && last.every((dep, at) => dep === deps[at])) return
    host.effects.set(key, deps)
    effect()
  }
}))

vi.mock('../src/renderer/store', () => ({
  Epoch: {},
  run: async ({ bot }: { bot: string }) => {
    host.reads.push(bot)
    return host.answer()
  }
}))

const { retryOfflinePictures, usePicture } = await import('../src/renderer/bots/pictures')

const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe("a bot's picture", () => {
  beforeEach(() => {
    host.reads = []
    host.effects.clear()
  })

  it('is read again once the link is back, when the read failed because the link was down', async () => {
    const bot = 'offline-bot' as BotId
    host.answer = () => ({ ok: false, refusal: { kind: 'offline', message: 'Not connected.' } })
    usePicture(bot)
    await settle()
    expect(usePicture(bot)).toBeNull()
    expect(host.reads, 'one read while the link is down').toEqual([bot])

    host.answer = () => ({ ok: true, value: PNG })
    retryOfflinePictures()
    usePicture(bot)
    await settle()
    expect(host.reads, 'read again once the link is back').toEqual([bot, bot])
    expect(usePicture(bot)).toMatch(/^blob:/)
  })

  it('is not read again while Hermes keeps refusing it for any other reason', async () => {
    const bot = 'refused-bot' as BotId
    host.answer = () => ({ ok: false, refusal: { kind: 'unsupported', message: "This Hermes can't edit bots." } })
    usePicture(bot)
    await settle()
    retryOfflinePictures()
    for (let draw = 0; draw < 5; draw++) expect(usePicture(bot)).toBeNull()
    expect(host.reads).toEqual([bot])
  })
})

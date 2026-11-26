import type { BotId, CommandOutcome } from '@highwing/hermes/domain'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { choosePicture, pickPicture, pictureDataUrl, readHead, type PictureDeps } from '../src/main/picture'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
const WEBP = new Uint8Array([...Buffer.from('RIFF'), 4, 0, 0, 0, ...Buffer.from('WEBPVP8 ')])
const RULE = { ok: false, refusal: { kind: 'rejected', message: 'Pick a PNG, JPEG or WebP picture of 2 MB or less.' } }
const RAE = 'rae' as BotId
const LIVE = () => true

function picker(file: Uint8Array | null | Error, setting: CommandOutcome = { ok: true, value: undefined }) {
  const sent: { bot: BotId; data: string }[] = []
  const deps: PictureDeps = {
    choose: async () => (file === null ? null : '/home/me/picture'),
    read: async (_path, limit) => {
      if (file instanceof Error) throw file
      return (file as Uint8Array).subarray(0, limit)
    },
    set: async (bot, data) => (sent.push({ bot, data }), setting)
  }
  return { deps, sent }
}

describe('pictureDataUrl', () => {
  it('names a PNG, JPEG or WebP by its bytes', () => {
    expect(pictureDataUrl(PNG)).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`)
    expect(pictureDataUrl(JPEG)?.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(pictureDataUrl(WEBP)?.startsWith('data:image/webp;base64,')).toBe(true)
  })

  it('takes a picture of exactly 2,000,000 bytes and not one byte more', () => {
    const sized = (size: number) => {
      const bytes = new Uint8Array(size)
      bytes.set(PNG)
      return bytes
    }
    expect(pictureDataUrl(sized(2_000_000))).not.toBeNull()
    expect(pictureDataUrl(sized(2_000_001))).toBeNull()
  })

  it('refuses a GIF, text, and nothing at all', () => {
    expect(pictureDataUrl(Buffer.from('GIF89a......'))).toBeNull()
    expect(pictureDataUrl(Buffer.from('just some words'))).toBeNull()
    expect(pictureDataUrl(new Uint8Array())).toBeNull()
  })
})

describe('choosePicture', () => {
  it('answers a picked picture as a data URL, and sends it nowhere', async () => {
    const { deps, sent } = picker(JPEG)
    expect(await choosePicture(deps)).toEqual({ ok: true, value: pictureDataUrl(JPEG) })
    expect(sent).toEqual([])
  })

  it('answers cancelled when the picker is closed', async () => {
    expect(await choosePicture(picker(null).deps)).toEqual({ ok: true, value: 'cancelled' })
  })

  it('refuses a file that is not a picture, is too big or cannot be read, in the same words as a bot\'s picture', async () => {
    const big = new Uint8Array(2_000_001)
    big.set(PNG)
    for (const file of [Buffer.from('not a picture'), big]) {
      expect(await choosePicture(picker(file).deps)).toEqual(RULE)
      expect(await pickPicture(picker(file).deps, RAE, LIVE)).toEqual(RULE)
    }
    expect(await choosePicture(picker(new Error('EACCES')).deps)).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Highwing couldn't read that file." } })
  })
})

describe('pickPicture', () => {
  it('sends a picked picture as a data URL for the bot', async () => {
    const { deps, sent } = picker(PNG)
    expect(await pickPicture(deps, RAE, LIVE)).toEqual({ ok: true, value: 'set' })
    expect(sent).toEqual([{ bot: 'rae', data: pictureDataUrl(PNG) }])
  })

  it('sends nothing, and says why, when another connection went live while the picker was open', async () => {
    const { deps, sent } = picker(PNG)
    expect(await pickPicture(deps, RAE, () => false)).toEqual({ ok: false, refusal: { kind: 'stale', message: "Highwing switched to another Hermes, so it didn't send that." } })
    expect(sent).toEqual([])
  })

  it('sends nothing when the picker is cancelled', async () => {
    const { deps, sent } = picker(null)
    expect(await pickPicture(deps, RAE, LIVE)).toEqual({ ok: true, value: 'cancelled' })
    expect(sent).toEqual([])
  })

  it('states the limit in words and sends nothing for a file that is not a picture or is too big', async () => {
    const big = new Uint8Array(3_000_000)
    big.set(PNG)
    for (const file of [Buffer.from('not a picture'), big]) {
      const { deps, sent } = picker(file)
      expect(await pickPicture(deps, RAE, LIVE)).toEqual(RULE)
      expect(sent).toEqual([])
    }
  })

  it('says so when the file cannot be read, and passes on a refusal from Hermes', async () => {
    expect(await pickPicture(picker(new Error('EACCES')).deps, RAE, LIVE)).toEqual({ ok: false, refusal: { kind: 'rejected', message: "Highwing couldn't read that file." } })
    const offline: CommandOutcome = { ok: false, refusal: { kind: 'offline', message: "Highwing isn't connected to Hermes right now." } }
    expect(await pickPicture(picker(PNG, offline).deps, RAE, LIVE)).toEqual(offline)
  })
})

describe('readHead', () => {
  it('reads no more than the limit, and all of a shorter file', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'highwing-picture-')), 'p.bin')
    writeFileSync(path, Buffer.alloc(10, 7))
    expect(Array.from(await readHead(path, 4))).toEqual([7, 7, 7, 7])
    expect(await readHead(path, 50)).toHaveLength(10)
    await expect(readHead(`${path}.missing`, 4)).rejects.toThrow()
  })
})

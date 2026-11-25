import type { AttachmentId } from '@highwing/hermes/domain'
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { StageResult } from '../src/ipc-contract'
import { attachmentStore, desktopSources, HERMES_LIMITS, sizeWords } from '../src/main/attachments'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
const PDF = new TextEncoder().encode('%PDF-1.7\nfake\n')
const MiB = 1024 * 1024

function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'highwing-attach-'))
  const dir = join(root, 'attachments')
  const file = (name: string, bytes: Uint8Array | string) => {
    const path = join(root, name)
    writeFileSync(path, bytes)
    return path
  }
  return { root, dir, file }
}

const held = (result: StageResult) => {
  if (!result.ok) throw new Error(`refused: ${result.reason}`)
  return result.attachment
}

describe('the attachment store', () => {
  it('holds an image and a file by what their bytes are, not their names, and reads each back', async () => {
    const { dir, file } = scratch()
    const store = attachmentStore(dir, HERMES_LIMITS)
    const image = held(await store.stage(file('error.pdf', PNG)))
    const contract = held(await store.stage(file('contract.png', PDF)))
    expect(image).toEqual({ id: expect.any(String), name: 'error.pdf', kind: 'image', size: PNG.byteLength })
    expect(contract).toEqual({ id: expect.any(String), name: 'contract.png', kind: 'file', size: PDF.byteLength })
    await expect(store.read(image.id)).resolves.toEqual({ ...image, mime: 'image/png', bytes: Buffer.from(PNG) })
    await expect(store.read(contract.id)).resolves.toEqual({ ...contract, mime: 'application/octet-stream', bytes: Buffer.from(PDF) })
  })

  it('holds bytes that have no path, as a pasted image does', async () => {
    const store = attachmentStore(scratch().dir, HERMES_LIMITS)
    const pasted = held(await store.stage({ name: 'Pasted image 1.png', bytes: PNG }))
    expect(pasted).toMatchObject({ name: 'Pasted image 1.png', kind: 'image' })
    await expect(store.read(pasted.id)).resolves.toMatchObject({ bytes: Buffer.from(PNG) })
  })

  it('keeps every file readable only by the user, in a folder only the user can open', async () => {
    const { dir, file } = scratch()
    await attachmentStore(dir, HERMES_LIMITS).stage(file('error.png', PNG))
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    for (const name of readdirSync(dir)) expect(statSync(join(dir, name)).mode & 0o777).toBe(0o600)
    expect(readdirSync(dir).map(name => name.slice(name.indexOf('.'))).sort()).toEqual(['.bin', '.json'])
  })

  it('refuses a file over the limit for its kind, naming the file and the limit', async () => {
    const { dir, file } = scratch()
    const store = attachmentStore(dir, { image: 1000, file: 2 * MiB })
    const big = new Uint8Array(1500)
    big.set(PNG)
    await expect(store.stage(file('error-big.png', big))).resolves.toEqual({ ok: false, name: 'error-big.png', reason: 'error-big.png is 1.5 KB. Hermes takes images up to 1000 bytes.' })
    await expect(store.stage(file('notes.txt', new Uint8Array(1500)))).resolves.toMatchObject({ ok: true })
    await expect(store.stage(file('dump.bin', new Uint8Array(2 * MiB + 1)))).resolves.toEqual({ ok: false, name: 'dump.bin', reason: 'dump.bin is 2.1 MB. Hermes takes files up to 2 MB.' })
    expect(readdirSync(dir)).toHaveLength(2)
  })

  it('refuses an empty file, a folder and a path that is not there, in words that name each', async () => {
    const { root, dir, file } = scratch()
    mkdirSync(join(root, 'photos'))
    const store = attachmentStore(dir, HERMES_LIMITS)
    await expect(store.stage(file('empty.txt', ''))).resolves.toEqual({ ok: false, name: 'empty.txt', reason: 'empty.txt is empty.' })
    await expect(store.stage(join(root, 'photos'))).resolves.toEqual({ ok: false, name: 'photos', reason: 'photos is a folder. Attach the files inside it.' })
    await expect(store.stage(join(root, 'gone.png'))).resolves.toEqual({ ok: false, name: 'gone.png', reason: "Highwing couldn't read gone.png." })
  })

  it('reads nothing for an id it does not hold, or one that would reach outside its folder', async () => {
    const { dir, file } = scratch()
    const store = attachmentStore(dir, HERMES_LIMITS)
    await store.stage(file('error.png', PNG))
    for (const id of ['../drafts/x', '00000000-0000-0000-0000-000000000000', '']) await expect(store.read(id as AttachmentId)).resolves.toBeNull()
  })

  it('sweeps every attachment it is not told to keep', async () => {
    const { dir, file } = scratch()
    const store = attachmentStore(dir, HERMES_LIMITS)
    const kept = held(await store.stage(file('error.png', PNG)))
    const swept = held(await store.stage(file('contract.pdf', PDF)))
    await store.sweep(new Set([kept.id]))
    await expect(store.read(kept.id)).resolves.not.toBeNull()
    await expect(store.read(swept.id)).resolves.toBeNull()
    expect(readdirSync(dir)).toHaveLength(2)
  })

  it('sweeps a folder that does not exist yet without throwing', async () => {
    await expect(attachmentStore(scratch().dir, HERMES_LIMITS).sweep(new Set())).resolves.toBeUndefined()
  })
})

describe('sizeWords', () => {
  it('rounds a size up and a limit down, so a file just over the limit never reads as the limit', () => {
    expect(sizeWords(25 * MiB, 'down')).toBe('25 MB')
    expect(sizeWords(25 * MiB + 1, 'up')).toBe('25.1 MB')
    expect(sizeWords(256 * MiB, 'down')).toBe('256 MB')
    expect(sizeWords(999, 'up')).toBe('999 bytes')
    expect(sizeWords(1, 'up')).toBe('1 byte')
  })
})

describe('desktopSources', () => {
  const never = { dialog: { showOpenDialog: () => Promise.reject(new Error('a dialog opened')) }, clipboard: { read: async () => [] }, focused: () => null }

  it('answers a pick from HIGHWING_PICK_FILES and opens no dialog', async () => {
    const sources = desktopSources(never as never, ['/a/error.png', '/b/contract.pdf'].join(delimiter))
    await expect(sources.pick()).resolves.toEqual(['/a/error.png', '/b/contract.pdf'])
  })

  it('reads the first image on the clipboard, and nothing from a clipboard of text', async () => {
    const image = { types: ['text/html', 'image/png'], getType: async () => new Blob([PNG], { type: 'image/png' }) }
    const text = { types: ['text/plain'], getType: async () => new Blob(['hi']) }
    const sources = (items: readonly unknown[]) => desktopSources({ ...never, clipboard: { read: async () => items } } as never, undefined)
    await expect(sources([text, image]).pasted()).resolves.toEqual({ name: 'Pasted image 1.png', bytes: PNG })
    await expect(sources([text]).pasted()).resolves.toBeNull()
  })
})

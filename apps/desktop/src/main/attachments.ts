import type { Upload } from '@highwing/hermes'
import type { Attachment, AttachmentId } from '@highwing/hermes/domain'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { basename, delimiter, join } from 'node:path'
import type { StageResult } from '../ipc-contract'
import { sniff } from './images'

export const ATTACHMENTS_DIR = 'attachments'
const VERSION = 1
const MiB = 1024 * 1024

/** The largest file of each kind, in bytes. */
export interface AttachLimits { readonly image: number; readonly file: number }

/** Hermes's own caps: `_ATTACH_BYTES_MAX_BYTES` for `image.attach_bytes` and `_ATTACHMENT_MAX_BYTES` for `file.attach` (tui_gateway/prompt_attachments.py:20). */
export const HERMES_LIMITS: AttachLimits = { image: 25 * MiB, file: 256 * MiB }

/** A path on this computer, or bytes that have none, such as an image read off the clipboard. */
export type StageSource = string | { readonly name: string; readonly bytes: Uint8Array }

export interface AttachmentStore {
  /** Copies the file into the store, or refuses it in words that name it. */
  stage(source: StageSource): Promise<StageResult>
  /** null for an id the store does not hold, or holds only part of. */
  read(id: AttachmentId): Promise<Upload | null>
  /** Deletes every attachment `keep` does not name. */
  sweep(keep: ReadonlySet<AttachmentId>): Promise<void>
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** The types `image.attach_bytes` stages. AVIF passes the image loader's sniff but goes to Hermes as a file. */
const HERMES_IMAGES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const SNIFF_BYTES = 64

function typeOf(head: Uint8Array): Pick<Upload, 'kind' | 'mime'> {
  const type = sniff(head)
  return type !== null && HERMES_IMAGES.has(type) ? { kind: 'image', mime: type } : { kind: 'file', mime: 'application/octet-stream' }
}

const UNITS = [{ unit: 'GB', bytes: 1024 * MiB }, { unit: 'MB', bytes: MiB }, { unit: 'KB', bytes: 1024 }] as const

/** A file's size rounds up and a limit down, so a file just over the limit never reads as the same number. */
export function sizeWords(bytes: number, round: 'up' | 'down'): string {
  const scale = UNITS.find(held => bytes >= held.bytes)
  if (scale === undefined) return bytes === 1 ? '1 byte' : `${bytes} bytes`
  const tenths = (round === 'up' ? Math.ceil : Math.floor)((bytes / scale.bytes) * 10)
  return `${tenths / 10} ${scale.unit}`
}

const refusal = (name: string, reason: string): StageResult => ({ ok: false, name, reason })
const unreadable = (name: string) => refusal(name, `Highwing couldn't read ${name}.`)

function overLimit(name: string, kind: Upload['kind'], size: number, limits: AttachLimits): StageResult | null {
  if (size === 0) return refusal(name, `${name} is empty.`)
  const limit = limits[kind]
  if (size <= limit) return null
  return refusal(name, `${name} is ${sizeWords(size, 'up')}. Hermes takes ${kind === 'image' ? 'images' : 'files'} up to ${sizeWords(limit, 'down')}.`)
}

async function head(path: string): Promise<Uint8Array> {
  const file = await open(path, 'r')
  try {
    const { buffer, bytesRead } = await file.read(new Uint8Array(SNIFF_BYTES), 0, SNIFF_BYTES, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

async function writeAtomic(file: string, content: Uint8Array | string): Promise<void> {
  const temp = await open(`${file}.tmp`, 'w', 0o600)
  try {
    await temp.writeFile(content)
    await temp.sync()
  } finally {
    await temp.close()
  }
  await rename(`${file}.tmp`, file)
}

function metaOf(text: string, id: AttachmentId): (Attachment & { readonly mime: string }) | null {
  const raw = JSON.parse(text) as Record<string, unknown> | null
  if (raw === null || typeof raw !== 'object' || raw.version !== VERSION || raw.id !== id) return null
  const { name, kind, size, mime } = raw
  if (typeof name !== 'string' || (kind !== 'image' && kind !== 'file') || !Number.isSafeInteger(size) || typeof mime !== 'string') return null
  return { id, name, kind, size: size as number, mime }
}

/** One `<id>.bin` and one `<id>.json` per attachment in `dir`, readable only by the user. */
export function attachmentStore(dir: string, limits: AttachLimits): AttachmentStore {
  const bin = (id: string) => join(dir, `${id}.bin`)
  const meta = (id: string) => join(dir, `${id}.json`)

  const keep = async (name: string, bytes: Uint8Array): Promise<StageResult> => {
    const { kind, mime } = typeOf(bytes.subarray(0, SNIFF_BYTES))
    const over = overLimit(name, kind, bytes.byteLength, limits)
    if (over !== null) return over
    const attachment: Attachment = { id: randomUUID() as AttachmentId, name, kind, size: bytes.byteLength }
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await writeAtomic(bin(attachment.id), bytes)
    await writeAtomic(meta(attachment.id), `${JSON.stringify({ version: VERSION, ...attachment, mime })}\n`)
    return { ok: true, attachment }
  }

  return {
    async stage(source) {
      const name = typeof source === 'string' ? basename(source) : source.name
      try {
        if (typeof source !== 'string') return await keep(name, source.bytes)
        const info = await stat(source)
        if (info.isDirectory()) return refusal(name, `${name} is a folder. Attach the files inside it.`)
        if (!info.isFile()) return unreadable(name)
        // Checked before the read, so a file far over the limit is never loaded into memory.
        const over = overLimit(name, typeOf(await head(source)).kind, info.size, limits)
        return over ?? await keep(name, await readFile(source))
      } catch {
        return unreadable(name)
      }
    },
    async read(id) {
      if (!ID.test(id)) return null
      try {
        const held = metaOf(await readFile(meta(id), 'utf8'), id)
        if (held === null) return null
        const bytes = await readFile(bin(id))
        return bytes.byteLength === held.size ? { ...held, bytes } : null
      } catch {
        return null
      }
    },
    async sweep(kept) {
      const names = await readdir(dir).catch(() => [])
      await Promise.all(names.filter(name => !kept.has(name.slice(0, name.indexOf('.')) as AttachmentId)).map(name => unlink(join(dir, name)).catch(() => {})))
    }
  }
}

/** Where attachments come from besides a drop. */
export interface AttachSources {
  /** The files the user picked in the file dialog, in order. Cancelled: none. */
  pick(): Promise<readonly string[]>
  /** The first image on the clipboard, or null when it holds none. */
  pasted(): Promise<StageSource | null>
}

/**
 * The system file dialog and clipboard. `picks`, when set, is `HIGHWING_PICK_FILES`: a list split like `PATH` that a verify
 * run answers every pick with, and no dialog opens.
 */
export function desktopSources(
  electron: { readonly dialog: Pick<Electron.Dialog, 'showOpenDialog'>; readonly clipboard: Pick<Electron.Clipboard, 'read'>; focused(): Electron.BrowserWindow | null },
  picks: string | undefined
): AttachSources {
  let pastes = 0
  return {
    async pick() {
      if (picks !== undefined) return picks.split(delimiter).filter(path => path !== '')
      const options: Electron.OpenDialogOptions = { title: 'Attach files', properties: ['openFile', 'multiSelections'] }
      const window = electron.focused()
      const { canceled, filePaths } = await (window === null ? electron.dialog.showOpenDialog(options) : electron.dialog.showOpenDialog(window, options))
      return canceled ? [] : filePaths
    },
    async pasted() {
      for (const item of await electron.clipboard.read()) {
        const type = item.types.find(held => held.startsWith('image/'))
        if (type === undefined) continue
        const blob = await item.getType(type)
        if (!(blob instanceof Blob)) continue
        return { name: `Pasted image ${++pastes}.${type.slice('image/'.length).replace('jpeg', 'jpg')}`, bytes: new Uint8Array(await blob.arrayBuffer()) }
      }
      return null
    }
  }
}

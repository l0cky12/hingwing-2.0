import { createHash } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { parseDraft, type Draft, type DraftKey } from '../ipc-contract'

export const DRAFTS_DIR = 'drafts'
const VERSION = 1

export interface DraftStore {
  /** Writes the draft, or deletes it when its text is empty. Applied in call order. */
  keep(draft: Draft): void
  load(): Promise<readonly Draft[]>
  /** Resolves once every `keep` so far has reached the disk or failed. */
  settled(): Promise<void>
}

export function readDraft(text: string): Draft | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (raw === null || typeof raw !== 'object' || (raw as { readonly version?: unknown }).version !== VERSION) return null
  const draft = parseDraft(raw)
  return draft === null || draft.text === '' ? null : draft
}

const fileOf = (dir: string, key: DraftKey) => join(dir, `${createHash('sha256').update(key).digest('hex').slice(0, 32)}.json`)

async function write(dir: string, { key, bot, text }: Draft): Promise<void> {
  const file = fileOf(dir, key)
  if (text === '') {
    await unlink(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    return
  }
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const temp = await open(`${file}.tmp`, 'w', 0o600)
  try {
    await temp.writeFile(`${JSON.stringify({ version: VERSION, key, bot, text })}\n`)
    await temp.sync()
  } finally {
    await temp.close()
  }
  await rename(`${file}.tmp`, file)
}

async function readAll(dir: string): Promise<readonly Draft[]> {
  const names = await readdir(dir).catch(() => [])
  const read = await Promise.all(names.filter(name => name.endsWith('.json')).map(name => readFile(join(dir, name), 'utf8').then(readDraft, () => null)))
  return read.filter(draft => draft !== null)
}

export function draftStore(dir: string): DraftStore {
  let chain: Promise<void> = Promise.resolve()
  return {
    keep(draft) {
      chain = chain.then(() => write(dir, draft)).catch((error: unknown) => console.error('Highwing could not keep a draft:', error))
    },
    load: () => chain.then(() => readAll(dir)),
    settled: () => chain
  }
}

import type { Feed } from '@highwing/hermes'
import { open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { isMode, type Mode } from '../ipc-contract'
import { feed } from './connection'

/** A choice the window shows, kept on disk as `{"version":1,"<key>":<value>}` in a file of its own. */
export interface Preference<T> {
  readonly file: string
  readonly key: string
  readonly is: (raw: unknown) => raw is T
  /** What a first launch shows, and what any file this build did not write reads as. */
  readonly fallback: T
}

export const MODE: Preference<Mode> = { file: 'mode.json', key: 'mode', is: isMode, fallback: 'bots' }

const VERSION = 1

export interface PreferenceStore<T> extends Feed<T> {
  /** Shows the choice at once and keeps it on disk. Saves apply in call order. A failed save is logged and the shown choice stays. */
  set(value: T): void
  /** Resolves once every `set` so far has reached the disk or failed. */
  settled(): Promise<void>
}

/** A preference file never stops the window opening: anything but a value this build wrote reads as the fallback. */
export function readPreference<T>({ key, is, fallback }: Preference<T>, text: string): T {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return fallback
  }
  if (raw === null || typeof raw !== 'object') return fallback
  const { version, [key]: value } = raw as { readonly version?: unknown; readonly [key: string]: unknown }
  return version === VERSION && is(value) ? value : fallback
}

async function write(file: string, key: string, value: unknown): Promise<void> {
  const temp = await open(`${file}.tmp`, 'w', 0o600)
  try {
    await temp.writeFile(`${JSON.stringify({ version: VERSION, [key]: value })}\n`)
    await temp.sync()
  } finally {
    await temp.close()
  }
  await rename(`${file}.tmp`, file)
}

export async function preferenceStore<T>(dir: string, preference: Preference<T>): Promise<PreferenceStore<T>> {
  const file = join(dir, preference.file)
  const shown = feed<T>(await readFile(file, 'utf8').then(text => readPreference(preference, text), () => preference.fallback))
  let chain: Promise<void> = Promise.resolve()
  return {
    get: shown.get,
    subscribe: shown.subscribe,
    set(next) {
      shown.set(next)
      chain = chain.then(() => write(file, preference.key, next)).catch((error: unknown) => console.error(`Highwing could not keep the ${preference.key}:`, error))
    },
    settled: () => chain
  }
}

import type { Feed } from '@highwing/hermes'
import { open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { isMode, type Mode } from '../ipc-contract'
import { feed } from './connection'

export const MODE_FILE = 'mode.json'
const VERSION = 1

export interface ModeStore {
  readonly mode: Feed<Mode>
  /** Shows the mode at once and keeps it on disk. Saves apply in call order. A failed save is logged and the shown mode stays. */
  set(mode: Mode): void
  /** Resolves once every `set` so far has reached the disk or failed. */
  settled(): Promise<void>
}

/** A preference file never stops the window opening: anything but a mode this build wrote reads as the bots. */
export function readMode(text: string): Mode {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return 'bots'
  }
  if (raw === null || typeof raw !== 'object') return 'bots'
  const { version, mode } = raw as { readonly version?: unknown; readonly mode?: unknown }
  return version === VERSION && isMode(mode) ? mode : 'bots'
}

async function write(file: string, mode: Mode): Promise<void> {
  const temp = await open(`${file}.tmp`, 'w', 0o600)
  try {
    await temp.writeFile(`${JSON.stringify({ version: VERSION, mode })}\n`)
    await temp.sync()
  } finally {
    await temp.close()
  }
  await rename(`${file}.tmp`, file)
}

export async function modeStore(dir: string): Promise<ModeStore> {
  const file = join(dir, MODE_FILE)
  const mode = feed(await readFile(file, 'utf8').then(readMode, (): Mode => 'bots'))
  let chain: Promise<void> = Promise.resolve()
  return {
    mode,
    set(next) {
      mode.set(next)
      chain = chain.then(() => write(file, next)).catch((error: unknown) => console.error('Highwing could not keep the mode:', error))
    },
    settled: () => chain
  }
}

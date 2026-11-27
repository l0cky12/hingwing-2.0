import type { Feed } from '@highwing/hermes'
import { open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { isMode, isSendKey, isSnoozes, isTheme, type Mode, type SendKey, type SnoozeCommand, type Snoozes, type Theme } from '../ipc-contract'
import { feed } from './connection'

export interface Preference<T> {
  readonly file: string
  readonly key: string
  readonly is: (raw: unknown) => raw is T
  readonly fallback: T
}

export const MODE: Preference<Mode> = { file: 'mode.json', key: 'mode', is: isMode, fallback: 'bots' }
export const THEME: Preference<Theme> = { file: 'theme.json', key: 'theme', is: isTheme, fallback: 'system' }
export const SEND_KEY: Preference<SendKey> = { file: 'send-key.json', key: 'sendKey', is: isSendKey, fallback: 'enter' }
export const SPELL_CHECK: Preference<boolean> = { file: 'spell-check.json', key: 'spellCheck', is: (raw): raw is boolean => typeof raw === 'boolean', fallback: true }
export const SNOOZES: Preference<Snoozes> = { file: 'snoozes.json', key: 'snoozes', is: isSnoozes, fallback: {} }

/** The snoozes after one snooze or wake. A snooze whose time has passed is dropped, so the file never grows with chats long awake. */
export function snoozed(held: Snoozes, { sessionId, until }: Omit<SnoozeCommand, 'do'>, now: number): Snoozes {
  const kept = Object.entries(held).filter(([id, at]) => id !== sessionId && at > now)
  return Object.fromEntries(until === null || until <= now ? kept : [...kept, [sessionId, until]])
}

const VERSION = 1

export interface PreferenceStore<T> extends Feed<T> {
  set(value: T): void
  settled(): Promise<void>
}

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

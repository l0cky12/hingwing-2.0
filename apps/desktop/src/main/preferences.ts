import type { Feed } from '@highwing/hermes'
import { open, readFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { isMode, isNotices, isOnClose, isSendKey, isSidebarWidth, isSnoozes, isTheme, type Mode, type Notices, type OnClose, type SendKey, type SidebarWidth, type SnoozeCommand, type Snoozes, type Theme } from '../ipc-contract'
import { feed } from './connection'

export interface Preference<T, Missing = T> {
  readonly file: string
  readonly key: string
  readonly is: (raw: unknown) => raw is T
  readonly fallback: Missing
}

export const MODE: Preference<Mode> = { file: 'mode.json', key: 'mode', is: isMode, fallback: 'bots' }
export const THEME: Preference<Theme> = { file: 'theme.json', key: 'theme', is: isTheme, fallback: 'system' }
export const SIDEBAR_WIDTH: Preference<SidebarWidth> = { file: 'sidebar-width.json', key: 'width', is: isSidebarWidth, fallback: 'full' }
export const ON_CLOSE: Preference<OnClose> = { file: 'on-close.json', key: 'onClose', is: isOnClose, fallback: 'quit' }
export const SEND_KEY: Preference<SendKey> = { file: 'send-key.json', key: 'sendKey', is: isSendKey, fallback: 'enter' }
export const SPELL_CHECK: Preference<boolean> = { file: 'spell-check.json', key: 'spellCheck', is: (raw): raw is boolean => typeof raw === 'boolean', fallback: true }
export const SNOOZES: Preference<Snoozes> = { file: 'snoozes.json', key: 'snoozes', is: isSnoozes, fallback: {} }
export const NOTICES: Preference<Notices> = { file: 'notices.json', key: 'notices', is: isNotices, fallback: { asks: true, replies: true, jobs: true } }

/** The snoozes after one snooze or wake. A snooze whose time has passed is dropped, so the file never grows with chats long awake. */
export function snoozed(held: Snoozes, { sessionId, until }: Omit<SnoozeCommand, 'do'>, now: number): Snoozes {
  const kept = Object.entries(held).filter(([id, at]) => id !== sessionId && at > now)
  return Object.fromEntries(until === null || until <= now ? kept : [...kept, [sessionId, until]])
}

const VERSION = 1

export interface PreferenceStore<T> extends Feed<T> {
  set(value: T): void
  commit(value: T): Promise<void>
  settled(): Promise<void>
}

export function readPreference<T, Missing = T>({ key, is, fallback }: Preference<T, Missing>, text: string): T | Missing {
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

export async function preferenceStore<T, Missing = T>(dir: string, preference: Preference<T, Missing>): Promise<PreferenceStore<T | Missing>> {
  const file = join(dir, preference.file)
  const shown = feed<T | Missing>(await readFile(file, 'utf8').then(text => readPreference(preference, text), () => preference.fallback))
  let chain: Promise<void> = Promise.resolve()
  return {
    get: shown.get,
    subscribe: shown.subscribe,
    set(next) {
      shown.set(next)
      chain = chain.then(() => write(file, preference.key, next)).catch((error: unknown) => console.error(`Highwing could not keep the ${preference.key}:`, error))
    },
    commit(next) {
      const placed = chain.then(() => write(file, preference.key, next)).then(() => {
        shown.set(next)
      })
      chain = placed.then(() => {}, () => {})
      return placed
    },
    settled: () => chain
  }
}

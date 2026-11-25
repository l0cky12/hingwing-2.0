import type { BotId } from '@highwing/hermes/domain'
import { useContext, useEffect, useSyncExternalStore } from 'react'
import { Epoch, run } from '../store'

type Entry = { readonly state: 'loading' } | { readonly state: 'loaded'; readonly url: string | null }

const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()
let version = 0

const changed = () => {
  version++
  for (const listener of listeners) listener()
}
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
const snapshot = () => version

const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([\s\S]*)$/

export function blobUrlOf(data: string): string | null {
  const [, type, base64] = DATA_URL.exec(data) ?? []
  if (type === undefined || base64 === undefined) return null
  try {
    return URL.createObjectURL(new Blob([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], { type }))
  } catch {
    return null
  }
}

const drop = (key: string) => {
  const entry = entries.get(key)
  if (entry?.state === 'loaded' && entry.url !== null) URL.revokeObjectURL(entry.url)
  entries.delete(key)
}

function load(key: string, bot: BotId) {
  const loading: Entry = { state: 'loading' }
  entries.set(key, loading)
  changed()
  void run({ do: 'botPicture', bot }).then(outcome => {
    if (entries.get(key) !== loading) return
    // A refusal draws the letter until this window changes the picture or the connection changes, rather than asking again at once.
    entries.set(key, { state: 'loaded', url: outcome.ok && outcome.value !== null ? blobUrlOf(outcome.value) : null })
    changed()
  })
}

export function usePicture(bot: BotId | null): string | null {
  const key = `${useContext(Epoch)} ${bot}`
  useSyncExternalStore(subscribe, snapshot, snapshot)
  const held = entries.has(key)
  useEffect(() => {
    if (bot !== null && !entries.has(key)) load(key, bot)
  }, [key, bot, held])
  const entry = entries.get(key)
  return bot !== null && entry?.state === 'loaded' ? entry.url : null
}

export function useForgetPicture(): (bot: BotId) => void {
  const epoch = useContext(Epoch)
  return bot => {
    drop(`${epoch} ${bot}`)
    changed()
  }
}

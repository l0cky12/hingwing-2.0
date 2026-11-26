import { createContext, useContext, useSyncExternalStore } from 'react'
import { applyPush, epochOf, type Bridge, type Setup, type Topic, type TopicValue, type WindowCommand } from '../ipc-contract'

declare global {
  interface Window { readonly highwing: Bridge }
}

interface Copy {
  value: unknown
  rev: number
  readonly listeners: Set<() => void>
  stop: (() => void) | null
}

/**
 * The connection a subtree reads from. A copy belongs to one epoch, so a subtree mounted for a new
 * connection starts empty and never draws what the old connection held.
 */
export const Epoch = createContext(0)

const copies = new Map<string, Copy>()
/** The epoch of the newest setup this window has. A chat command names ids of that connection, so main refuses it once another one is live. */
let epoch = 0

function start(topic: Topic, copy: Copy) {
  copy.stop = window.highwing.watch(topic, push => {
    const next = applyPush(copy.value as TopicValue<Topic> | undefined, copy.rev, push)
    if (next === 'need-full') {
      copy.stop?.()
      start(topic, copy)
      return
    }
    copy.value = next.value
    copy.rev = next.rev
    if (topic === 'setup') epoch = epochOf(next.value as Setup)
    for (const listener of copy.listeners) listener()
  })
}

function copyOf(key: string): Copy {
  const held = copies.get(key)
  if (held !== undefined) return held
  const copy: Copy = { value: undefined, rev: 0, listeners: new Set(), stop: null }
  copies.set(key, copy)
  return copy
}

const subscribers = new Map<string, (listener: () => void) => () => void>()
const subscribe = (key: string, topic: Topic) => {
  const held = subscribers.get(key)
  if (held !== undefined) return held
  const created = (listener: () => void) => {
    const copy = copyOf(key)
    copy.listeners.add(listener)
    if (copy.stop === null) start(topic, copy)
    return () => {
      copy.listeners.delete(listener)
      if (copy.listeners.size > 0) return
      copy.stop?.()
      copies.delete(key)
    }
  }
  subscribers.set(key, created)
  return created
}

const NEVER = () => () => {}

/** `topic` null: nothing to read yet, as for the session of a chat that has not been started. */
export function useTopic<T extends Topic>(topic: T | null): TopicValue<T> | undefined {
  const key = `${useContext(Epoch)} ${topic}`
  return useSyncExternalStore(topic === null ? NEVER : subscribe(key, topic), () => copies.get(key)?.value as TopicValue<T> | undefined)
}

export const run = <C extends WindowCommand>(command: C) => window.highwing.run(command, epoch)

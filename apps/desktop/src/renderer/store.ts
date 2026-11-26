import { createContext, useContext, useSyncExternalStore } from 'react'
import { applyPush, type Bridge, type Setup, type Topic, type TopicValue } from '../ipc-contract'
import { screenOf } from './setup/screens'

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

const keyOf = (epoch: number, topic: Topic) => `${epoch} ${topic}`

/** `topic` null: nothing to read yet, as for the session of a chat that has not been started. */
export function useTopic<T extends Topic>(topic: T | null): TopicValue<T> | undefined {
  const key = keyOf(useContext(Epoch), topic as T)
  return useSyncExternalStore(topic === null ? NEVER : subscribe(key, topic), () => copies.get(key)?.value as TopicValue<T> | undefined)
}

/**
 * Opening a bot or chat while Settings is up leaves Settings first, and opens only once main agrees.
 * While main saves a new connection it refuses, and nothing moves. The sidebar and the palette both
 * open through here. App reads the setup state outside any epoch.
 */
export const run: Bridge['run'] = async command => {
  const setup = copies.get(keyOf(0, 'setup'))?.value as Setup | undefined
  if (command.do === 'open' && setup !== undefined && screenOf(setup).show === 'settings') {
    const left = await window.highwing.run({ do: 'keepTarget' })
    if (!left.ok) return left
  }
  return window.highwing.run(command)
}

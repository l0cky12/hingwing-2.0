import { useSyncExternalStore } from 'react'
import { applyPush, type Bridge, type Topic, type TopicValue } from '../ipc-contract'

declare global {
  interface Window { readonly highwing: Bridge }
}

interface Copy {
  value: unknown
  rev: number
  readonly listeners: Set<() => void>
  stop: (() => void) | null
}

const copies = new Map<Topic, Copy>()

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

function copyOf(topic: Topic): Copy {
  const held = copies.get(topic)
  if (held !== undefined) return held
  const copy: Copy = { value: undefined, rev: 0, listeners: new Set(), stop: null }
  copies.set(topic, copy)
  return copy
}

const subscribers = new Map<Topic, (listener: () => void) => () => void>()
const subscribe = (topic: Topic) => {
  const held = subscribers.get(topic)
  if (held !== undefined) return held
  const created = (listener: () => void) => {
    const copy = copyOf(topic)
    copy.listeners.add(listener)
    if (copy.stop === null) start(topic, copy)
    return () => {
      copy.listeners.delete(listener)
      if (copy.listeners.size > 0) return
      copy.stop?.()
      copies.delete(topic)
    }
  }
  subscribers.set(topic, created)
  return created
}

export function useTopic<T extends Topic>(topic: T): TopicValue<T> | undefined {
  return useSyncExternalStore(subscribe(topic), () => copies.get(topic)?.value as TopicValue<T> | undefined)
}

export const run: Bridge['run'] = command => window.highwing.run(command)

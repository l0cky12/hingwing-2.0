/**
 * The whole contract between Electron main and every window. Imported by main, preload and renderer.
 * Main owns the truth (`Hermes`); a window holds a read-only copy kept current by pushes.
 */
import type { Item, Link, OpenTurn, Session, SessionId, SettledTurn, Sidebar } from '@highwing/hermes/domain'
import type { Command, Outcome, ResultOf } from '@highwing/hermes'

export type Topic = 'link' | 'sidebar' | `session:${SessionId}`
export type TopicValue<T extends Topic> = T extends 'link' ? Link : T extends 'sidebar' ? Sidebar : Session

/**
 * "Replace everything from index `from` with `items`." One form covers append, in-place change of the
 * tail and full replacement. Main finds `from` by comparing references with the last value it pushed,
 * which works because `reduce` keeps the identity of what it did not touch.
 */
export interface Tail<T> { readonly from: number; readonly items: readonly T[] }

type Running = Extract<Session['run'], { state: 'running' }>
/** A session change, relative to the value the window holds at `rev - 1`. */
export interface SessionPatch {
  readonly rest: Omit<Session, 'history' | 'run'>
  readonly history: Tail<SettledTurn>
  readonly run:
    | { readonly state: 'idle' }
    | { readonly state: 'running'; readonly head: Omit<Running, 'turn'>; readonly turn: Omit<OpenTurn, 'items'>; readonly items: Tail<Item> }
}

export type Push<T extends Topic = Topic> =
  /** First push after `watch`, and the answer when a window reports it cannot apply a patch. */
  | { readonly topic: T; readonly rev: number; readonly full: TopicValue<T> }
  /** Sessions only. A window that is not at `rev - 1` drops the patch and calls `watch` again for a full value. */
  | (T extends `session:${string}` ? { readonly topic: T; readonly rev: number; readonly patch: SessionPatch } : never)

/** `window.highwing`: everything the preload script exposes. Two functions. */
export interface Bridge {
  /** Starts pushes for a topic. Returns the function that stops them. Main also stops them when the window closes. */
  watch<T extends Topic>(topic: T, onPush: (push: Push<T>) => void): () => void
  /**
   * Main validates the shape of `command` and the sender frame before it reaches `Hermes.run`.
   * The validators are one object typed `{ [K in Command['do']]: (raw: unknown) => Extract<Command, { do: K }> | null }`,
   * so a command added to the union without a validator fails `tsc`.
   */
  run<C extends Command>(command: C): Promise<Outcome<ResultOf<C>>>
}

/**
 * Renderer side (renderer/store.ts), the only caller of `Bridge.watch`:
 *
 *   useTopic('link'): Link | undefined
 *   useTopic('sidebar'): Sidebar | undefined
 *   useTopic(`session:${id}`): Session | undefined      // undefined until the first full push
 *
 * It applies pushes with `applyPush` and feeds React through useSyncExternalStore. The copy is never
 * written by anything else. Per-window state that is not Hermes's (which session is selected, which
 * rows are open, composer drafts) lives in React state beside it.
 */
export function applyPush<T extends Topic>(current: TopicValue<T> | undefined, currentRev: number, push: Push<T>): { readonly value: TopicValue<T>; readonly rev: number } | 'need-full' {
  throw new Error('not implemented')
}

/** Main side (main/ipc.ts): serves every topic from one `Hermes` to any number of windows. Pushes are coalesced to one per topic per 16 ms. */
export declare function serveWindows(hermes: import('@highwing/hermes').Hermes): { dispose(): void }

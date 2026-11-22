import { dialWith, systemClock, wireSocket, type Clock, type Dialer, type WireSocket } from '../wire/link'
import type { Fixture } from './fixture'
import { RING_FRAMES, ScriptedGateway } from './gateway'
import { loopback, type Loopback, type Upgrade } from './loopback'

export interface ScriptOptions {
  /** `'instant'` for tests, `'recorded'` for the dev app (`HIGHWING_FIXTURE=fixtures/errand.jsonl pnpm dev`). */
  readonly timing?: 'instant' | 'recorded'
  /**
   * `'memory'` (default): the fake sits at the `WireSocket` seam. `'loopback'`: the same fake listens
   * on 127.0.0.1 and the client reaches it through the real dial code (`dialWith`), with the fake's
   * own single-use tickets in place of the Hermes CLI.
   */
  readonly transport?: 'memory' | 'loopback'
  /**
   * Close the socket after the client received this many pushes. The story then publishes up to
   * `missed` more frames while no socket is attached, stopping early at a call it waits for, so
   * they can reach the client only through replay.
   */
  readonly drop?: { readonly afterPush: number; readonly missed: number }
  /** Frames the replay ring keeps per session. Default 512, the gateway's own bound. A small value forces `snapshot_required`. */
  readonly ringFrames?: number
  /** Paces the story and expires loopback tickets. Default the system clock. */
  readonly clock?: Clock
}

export interface ScriptedDialer extends Dialer {
  /** Resolves when the story has played every step. Rejects when the client makes a call the story did not expect. */
  readonly done: Promise<void>
  readonly finished: boolean
  /** Sockets the gateway accepted. */
  readonly dials: number
  /** Every frame the client sent, parsed, in order. */
  readonly received: readonly unknown[]
  /** The index of the step the story is at. */
  readonly step: number
  /** Loopback only: every upgrade the listener saw. */
  readonly upgrades: readonly Upgrade[]
  /** Stops the loopback listener. */
  close(): Promise<void>
}

/** A socket pair in memory. Each direction delivers in order, one microtask later, as a network would: never inside the sender's call. */
function memorySocket(gateway: ScriptedGateway): WireSocket {
  let open = true
  const wire = wireSocket({
    send: text => queueMicrotask(() => accepted.text(text)),
    close: () => {
      if (!open) return
      open = false
      queueMicrotask(() => accepted.closed())
    }
  })
  const accepted = gateway.accept({
    write: frame => {
      const text = JSON.stringify(frame)
      queueMicrotask(() => {
        if (open) wire.text(text)
      })
    },
    close: code => queueMicrotask(() => {
      if (!open) return
      open = false
      wire.closed(code, '')
    })
  })
  return wire.socket
}

/**
 * A `Dialer` that plays a fixture as a gateway would. It enforces the real gateway's rules, so a
 * client protocol bug fails a fixture test instead of waiting for a live provider:
 * - Closed key sets. The dispatcher's check runs on every call, from the vendored
 *   `wire/contract.openrpc.json` (`checkParams`), and each handler adds its own.
 * - Attach before act. A submit or an answer on a socket that has not created or resumed the
 *   session gets `permission_denied`.
 * - Loopback only: the upgrade is refused when it carries an `Origin` header, a ticket that was
 *   used before or is older than 30 s, or anything but exactly one ticket subprotocol.
 * It answers by itself: gateway.ready, client.capabilities, runtime.describe, gateway.ping,
 * session.list, session.detach, and the attach calls. `session.resume` and `session.events.since`
 * are answered from the frames pushed so far (watermark, running, generation, open prompts, the
 * ring) and the current stored rows. Frames published between a `since` answer and the resume that
 * follows are written to the socket before the resume reply, as the gateway's catch-up does.
 * It reads the frames it pushes with `parseEvent`, so the envelope's field names stay in `wire/parse.ts`.
 */
export function scriptedDialer(fixture: Fixture, options: ScriptOptions = {}): ScriptedDialer {
  const clock = options.clock ?? systemClock
  const gateway = new ScriptedGateway(fixture, {
    clock, timing: options.timing ?? 'instant', ringFrames: options.ringFrames ?? RING_FRAMES, drop: options.drop ?? null
  })
  let listener: Promise<Loopback> | null = null
  let upgrades: readonly Upgrade[] = []
  const overLoopback = dialWith(async () => {
    const held = await (listener ??= loopback(gateway, clock))
    upgrades = held.upgrades
    return held.mint()
  })
  const dial: Dialer = options.transport === 'loopback' ? overLoopback : async () => memorySocket(gateway)
  return Object.defineProperties((request: { readonly start: boolean }) => dial(request), {
    done: { value: gateway.done },
    finished: { get: () => gateway.finished },
    dials: { get: () => gateway.dials },
    received: { get: () => gateway.received },
    step: { get: () => gateway.step },
    upgrades: { get: () => upgrades },
    close: { value: async () => (await listener)?.close() }
  }) as ScriptedDialer
}

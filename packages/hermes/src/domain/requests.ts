import type { CardRequest } from './reduce'
import type { Asked, HermesRequest, NoticeItem, RecordedReply, RequestAsk, RequestEnd, RequestId } from './session'

export interface Held {
  readonly requests: readonly HermesRequest[]
  /**
   * Ids of requests Hermes closed, newest last, at most `CLOSED_KEPT`. A request frame carries no
   * stream position, so only this tells a late copy of a closed request from a new one.
   */
  readonly closed: readonly RequestId[]
}

export type ClosedNotice = Extract<NoticeItem, { what: 'closed' }>
export interface Change extends Held { readonly notices: readonly ClosedNotice[] }

/** Why Hermes closed a request. `resolved`: some client settled it, and Hermes does not say which. */
export type CloseWhy = 'resolved' | Exclude<RequestEnd, 'answered' | 'skipped' | 'elsewhere'>

export const CLOSED_KEPT = 64
export const UNDELIVERED = "Hermes didn't get your answer."

const WAITING: HermesRequest['state'] = { s: 'waiting', error: null }

const askedOf = (ask: RequestAsk): Asked => (ask.kind === 'secret' ? ask.for.is : ask.kind)

function endOf(request: HermesRequest, why: CloseWhy): RequestEnd {
  if (why !== 'resolved') return why
  if (request.state.s === 'waiting') return 'elsewhere'
  return request.state.reply.kind === 'skip' ? 'skipped' : 'answered'
}

const remembered = (closed: readonly RequestId[], id: RequestId): readonly RequestId[] =>
  closed.includes(id) ? closed : [...closed, id].slice(-CLOSED_KEPT)

function refreshed(held: HermesRequest, ask: RequestAsk): HermesRequest {
  if (held.ask.kind === 'connect' && ask.kind === 'connect') return ask.rev > held.ask.rev ? { ...held, ask } : held
  if (held.ask.kind !== 'questions' || ask.kind !== 'questions') return held
  const { answers } = held.ask
  const same = Object.keys(ask.answers).length === Object.keys(answers).length
    && Object.entries(ask.answers).every(([id, answer]) => JSON.stringify(answers[id]) === JSON.stringify(answer))
  return same ? held : { ...held, ask }
}

function edit(held: Held, id: RequestId, change: (request: HermesRequest) => HermesRequest): Held {
  const requests = held.requests.map(request => (request.id === id ? change(request) : request))
  return requests.every((request, index) => request === held.requests[index]) ? held : { ...held, requests }
}

export function opened(held: Held, { requestId, ask, waitS }: CardRequest, seenAt: number | null): Held {
  if (held.closed.includes(requestId)) return held
  if (held.requests.some(request => request.id === requestId)) return edit(held, requestId, request => refreshed(request, ask))
  const deadline = seenAt === null || waitS === null ? null : seenAt + waitS * 1000
  return { ...held, requests: [...held.requests, { id: requestId, ask, state: WAITING, deadline }] }
}

export function closed(held: Held, id: RequestId, why: CloseWhy): Change {
  const request = held.requests.find(open => open.id === id)
  const kept = remembered(held.closed, id)
  if (request === undefined) return { requests: held.requests, closed: kept, notices: [] }
  return {
    requests: held.requests.filter(open => open !== request),
    closed: kept,
    notices: [{ kind: 'notice', what: 'closed', requestId: id, asked: askedOf(request.ask), end: endOf(request, why) }]
  }
}

export function reconciled(held: Held, listed: readonly CardRequest[], parked: readonly CardRequest[], cancelled: ReadonlyMap<RequestId, CloseWhy>): Change {
  const gone = held.requests.filter(request => !listed.some(open => open.requestId === request.id))
  const after = gone.reduce<Change>((change, request) => {
    const next = closed(change, request.id, cancelled.get(request.id) ?? 'resolved')
    return { ...next, notices: [...change.notices, ...next.notices] }
  }, { ...held, notices: [] })
  const relisted = listed.reduce<Held>((change, open) => {
    const known = change.requests.some(request => request.id === open.requestId)
    const reopened: Held = known ? change : { ...change, closed: change.closed.filter(id => id !== open.requestId) }
    return edit(opened(reopened, open, null), open.requestId, request =>
      request.state.s === 'sending' ? { ...request, state: { s: 'waiting', error: UNDELIVERED } } : request)
  }, after)
  const dead = parked.filter(request => cancelled.has(request.requestId))
  const forgotten: Held = dead.reduce<Held>((change, request) => ({ ...change, closed: remembered(change.closed, request.requestId) }), relisted)
  const settled = parked.reduce<Held>((change, request) => opened(change, request, null), forgotten)
  return { requests: settled.requests, closed: settled.closed, notices: after.notices }
}

export function answering(held: Held, id: RequestId, reply: RecordedReply): Held {
  return edit(held, id, request => (request.state.s === 'waiting' ? { ...request, state: { s: 'sending', reply } } : request))
}

export function accepted(held: Held, id: RequestId, then: 'waits' | 'settles'): Held {
  return edit(held, id, request => {
    if (request.state.s !== 'sending') return request
    const { reply } = request.state
    const ask: RequestAsk = request.ask.kind === 'questions' && reply.kind === 'lock'
      ? { ...request.ask, answers: { ...request.ask.answers, [reply.question]: reply.answer } }
      : request.ask
    return { ...request, ask, state: then === 'waits' ? WAITING : request.state }
  })
}

export function failed(held: Held, id: RequestId, message: string): Held {
  return edit(held, id, request => (request.state.s === 'sending' ? { ...request, state: { s: 'waiting', error: message } } : request))
}

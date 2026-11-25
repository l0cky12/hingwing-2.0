import { refusalOf, refused } from './actor'
import type { Outcome } from './domain/command'
import type { SessionId } from './domain/session'
import { branchPoint, familiesOf, versionsOf, type BranchPoint, type ChatVersions, type Said } from './domain/versions'
import type { Calls } from './wire/link'
import { parseSaid, parseTreeRows } from './wire/parse'

/**
 * Hermes puts a project's chats in `previewSessions`, newest first and three unless asked for more
 * (tui_gateway/project_tree.py:439-442), and leaves the lanes empty (tui_gateway/methods_config.py:137-150). It reads at
 * most `session_limit` chats, 2000 by default, so asking for that many previews lists every chat it read.
 */
const TREE = { preview_limit: 2000 } as const
/** The most rows a page holds (the `session.transcript` contract). */
const PAGE_ROWS = 500
const MOST_PAGES = 20
const UNREADABLE = refused('unsupported', "Highwing can't read this chat's versions from Hermes.")

class Unreadable extends Error {}

/** Oldest order ends in an empty page and its cursor is never null. `reset` means the page is the first one again. */
async function transcript(via: Calls, sessionId: SessionId): Promise<readonly Said[]> {
  let rows: readonly Said[] = []
  let cursor: string | null = null
  for (let read = 0; read < MOST_PAGES; read++) {
    const page = parseSaid(await via.call('session.transcript', {
      session_id: sessionId, order: 'oldest', limit: PAGE_ROWS, inline_images: false, ...(cursor === null ? {} : { cursor })
    }))
    if (page === null) throw new Unreadable()
    rows = page.reset ? page.said : [...rows, ...page.said]
    if (page.said.length === 0 || page.next === null) return rows
    cursor = page.next
  }
  throw new Unreadable()
}

export async function readVersions(via: Calls, sessionId: SessionId): Promise<Outcome<ChatVersions>> {
  try {
    const rows = parseTreeRows(await via.call('projects.tree', TREE))
    if (rows === null) return UNREADABLE
    const family = familiesOf(rows, sessionId)
    const reads = new Map<SessionId, Promise<readonly Said[]>>()
    const read = (id: SessionId) => reads.get(id) ?? reads.set(id, transcript(via, id)).get(id) as Promise<readonly Said[]>
    const pairs = [...(family.above?.children ?? []).map(child => [family.above?.parent as SessionId, child] as const), ...family.below.map(child => [sessionId, child] as const)]
    const points = await Promise.all(pairs.map(async ([parent, child]): Promise<[SessionId, BranchPoint | null]> => [child, branchPoint(await read(parent), await read(child))]))
    return { ok: true, value: versionsOf(sessionId, family, new Map(points)) }
  } catch (error) {
    return error instanceof Unreadable ? UNREADABLE : { ok: false, refusal: refusalOf(error) }
  }
}

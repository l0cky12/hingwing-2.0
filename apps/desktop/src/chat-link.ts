import type { SessionId } from '@highwing/hermes/domain'

const PREFIX = 'highwing://chat/'
const MINTED_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export const chatLink = (sessionId: SessionId): string => `${PREFIX}${sessionId}`

export function parseChatLink(text: string): SessionId | null {
  const url = URL.parse(text)
  if (url === null || url.protocol !== 'highwing:' || url.host !== 'chat' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') return null
  const id = url.pathname.slice(1)
  // `href` differs from the text when parsing changed it, as `chat/a/../b` becomes `chat/b`.
  return url.pathname.startsWith('/') && MINTED_ID.test(id) && url.href === text ? (id as SessionId) : null
}

/** Chromium puts its own switches around the link, so no place in it is assumed. */
export function chatLinkIn(argv: readonly string[]): SessionId | null {
  for (const arg of argv) {
    const sessionId = parseChatLink(arg)
    if (sessionId !== null) return sessionId
  }
  return null
}

import type { Landing, SessionId, Version } from '@highwing/hermes/domain'

/** The message a press on a version asked to land at. Held outside `Chat`, because the chat the press opens mounts a new one. */
let asked: Version | null = null

export const landAt = (version: Version): void => { asked = version }

/** Where the thread of this chat should land, until `landed` or another press. */
export const landingFor = (sessionId: SessionId): Landing | null => (asked?.sessionId === sessionId ? asked.landing : null)

export const landed = (sessionId: SessionId): void => {
  if (asked?.sessionId === sessionId) asked = null
}

import type { Landing, SessionId, Version } from '@highwing/hermes/domain'

let asked: Version | null = null

export const landAt = (version: Version): void => { asked = version }

export const landingFor = (sessionId: SessionId): Landing | null => (asked?.sessionId === sessionId ? asked.landing : null)

export const landed = (sessionId: SessionId): void => {
  if (asked?.sessionId === sessionId) asked = null
}

import type { Landing, SessionId, Version } from '@highwing/hermes/domain'

let asked: Version | null = null

/** Each press is held as its own object, so a late answer to an earlier press can clear only that press. */
export const landAt = (version: Version): void => { asked = { ...version } }

export const pressFor = (sessionId: SessionId): Version | null => (asked?.sessionId === sessionId ? asked : null)

export const landingFor = (sessionId: SessionId): Landing | null => pressFor(sessionId)?.landing ?? null

export const landed = (sessionId: SessionId): void => {
  if (asked?.sessionId === sessionId) asked = null
}

export const forget = (press: Version): void => {
  if (asked === press) asked = null
}

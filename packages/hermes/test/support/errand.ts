import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadFixture, type Fixture, type FixtureStep, type GroupsScript } from '../../src/testing/fixture'

export const ERRAND = loadFixture(fileURLToPath(new URL('../../../../fixtures/errand.jsonl', import.meta.url)))
export const SESSION = ERRAND.header.sessionId
export const BRANCH = loadFixture(fileURLToPath(new URL('../../../../fixtures/branch.jsonl', import.meta.url)))
export const BRANCH_OLD = loadFixture(fileURLToPath(new URL('../../../../fixtures/branch-old.jsonl', import.meta.url)))
export const BRANCH_COMPACTED = loadFixture(fileURLToPath(new URL('../../../../fixtures/branch-compacted.jsonl', import.meta.url)))
export const EDIT_COMPACTED = loadFixture(fileURLToPath(new URL('../../../../fixtures/edit-compacted.jsonl', import.meta.url)))
export const SLASH = loadFixture(fileURLToPath(new URL('../../../../fixtures/slash.jsonl', import.meta.url)))

export const PROFILES: unknown = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/profiles/roster.json', import.meta.url)), 'utf8'))
export const WITH_BOTS: Fixture = { ...ERRAND, header: { ...ERRAND.header, profiles: PROFILES } }
/** A Hermes whose sockets reach only the profile attach ran in. */
export const BOUND: Fixture = { ...WITH_BOTS, header: { ...WITH_BOTS.header, reach: 'profile' } }
/** A Hermes whose default bot has no Bot Chat yet. */
export const NO_HOME_CHAT: Fixture = { ...WITH_BOTS, header: { ...WITH_BOTS.header, homeBotChat: false } }
/** The Bot Chat `roster.json` names for the bot `research`, and the line it previews. */
export const RESEARCH_CHAT = 'local-0001' as typeof SESSION
export const RESEARCH_SAID = "In Let's talk about QAing your"

const { chats: SEEDS, ...SEEDED_PROFILES } = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/profiles/chats.json', import.meta.url)), 'utf8')) as { chats: NonNullable<Fixture['header']['chats']> }
export const WITH_CHATS: Fixture = { ...ERRAND, header: { ...ERRAND.header, profiles: SEEDED_PROFILES, chats: SEEDS } }
export const [REMINDER, INVOICES, DOWNLOADS] = ['local-0101', 'local-0102', 'local-0103'] as (typeof SESSION)[] as [typeof SESSION, typeof SESSION, typeof SESSION]

const { relay: RELAY, ...TEAM_PROFILES } = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/profiles/team.json', import.meta.url)), 'utf8')) as { relay: NonNullable<Fixture['header']['relay']> }
/** Ada, the default bot, with Sam and Rae, on a Hermes that cannot hand a message to another bot. */
export const TEAM_NO_RELAY: Fixture = { ...ERRAND, header: { ...ERRAND.header, profiles: TEAM_PROFILES } }
/** The same three on a Hermes that can: Rae answers after 1500 ms and Sam is not running. */
export const TEAM: Fixture = { ...TEAM_NO_RELAY, header: { ...TEAM_NO_RELAY.header, relay: RELAY } }
export const RAE_SAID = (RELAY.rae as { reply: string }).reply

const { groups: GROUPS, ...LAUNCH_PROFILES } = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/profiles/launch.json', import.meta.url)), 'utf8')) as { groups: GroupsScript }
export const LAUNCH_NO_GROUPS: Fixture = { ...ERRAND, header: { ...ERRAND.header, profiles: LAUNCH_PROFILES } }
export const LAUNCH: Fixture = { ...LAUNCH_NO_GROUPS, header: { ...LAUNCH_NO_GROUPS.header, groups: GROUPS } }
export const withGroups = (groups: GroupsScript): Fixture => ({ ...LAUNCH, header: { ...LAUNCH.header, groups } })

export const stepOf =(method: string) => ERRAND.steps.findIndex(step => 'await' in step && step.await === method)
export const paramsOf = (method: string) => (ERRAND.steps[stepOf(method)] as Extract<FixtureStep, { await: string }>).params as Record<string, unknown>

export const SUDO = 'srq-0123456789ab'
export const SUDO_ASK = { push: { jsonrpc: '2.0', id: SUDO, method: 'sudo', params: { session_id: SESSION, command: 'sudo true' } } }
export const PICK = 'srq-ba5eba11cafe'
export const PICK_ASK = { push: { jsonrpc: '2.0', id: PICK, method: 'theme.pick', params: { session_id: SESSION, picker: 'accent' } } }
export const PICK_DECLINED = { answer: PICK, error: { code: -32601, message: 'Highwing has no part of its window to answer this with.' } }

export type Added = { readonly push: unknown } | { readonly answer: string; readonly result: unknown } | { readonly answer: string; readonly error: { readonly code: number; readonly message: string } }

export function withSteps(afterPush: number, ...steps: readonly Added[]): Fixture {
  const pushes = ERRAND.steps.flatMap((step, index) => ('push' in step ? [index] : []))
  const at = pushes[afterPush - 1] as number
  const added = steps.map((step): FixtureStep => ({ at: ERRAND.steps[at]?.at ?? 0, ...step }))
  return { ...ERRAND, steps: [...ERRAND.steps.slice(0, at + 1), ...added, ...ERRAND.steps.slice(at + 1)] }
}

export interface Sent { readonly method: string; readonly params?: Record<string, unknown> }

export const callsIn = (received: readonly unknown[]): Sent[] =>
  received.flatMap(frame => {
    const { method, params } = frame as Partial<Sent>
    return method === undefined || method === 'gateway.ping' ? [] : [{ method, ...(params === undefined ? {} : { params }) }]
  })

const { chats: FAMILY, ...FAMILY_PROFILES } = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/profiles/versions.json', import.meta.url)), 'utf8')) as { chats: NonNullable<Fixture['header']['chats']> }
export const NO_TREE: Fixture = { ...ERRAND, header: { ...ERRAND.header, profiles: FAMILY_PROFILES, chats: FAMILY, branches: true } }
export const WITH_VERSIONS: Fixture = { ...NO_TREE, header: { ...NO_TREE.header, tree: true } }
export const [SORTED, SORTED_2, SORTED_3] = ['local-0201', 'local-0202', 'local-0203'] as (typeof SESSION)[] as [typeof SESSION, typeof SESSION, typeof SESSION]

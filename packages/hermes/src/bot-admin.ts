import { refusalOf } from './actor'
import { GENERATED_MAX_BYTES, MARK_SETS, PICTURE_RULE, type BotCreated, type BotDetails, type BotDraft, type BotEdit, type BotId, type BotMark, type PetChoice } from './domain/bots'
import type { Command, ModelMenu, Outcome, Refusal } from './domain/command'
import type { BotManagers } from './domain/passwords'
import type { Plugin } from './domain/plugins'
import type { Skill } from './domain/skills'
import type { Added, ServerSetup, Tested, ToolServer } from './domain/tool-servers'
import { NOT_CONNECTED } from './open'
import { METHOD_NOT_FOUND, Offline, RpcRefusal, type Connection } from './wire/link'
import {
  descriptionOf, parseBotAt, parseBotManagers, parseBotRecord, parseCatalog, parseConfigured, parseCreated, parseDenyRules, parseDetails, parseGenerated, parseImageProbe, parseModelMenu, parsePetPicture, parsePets,
  parsePicture, parsePlugins, parseSkillStates, parseSkillText, parseTested, parseToolServers, type Configured
} from './wire/parse'

export type Wire = Pick<Connection, 'call' | 'as'>
export type Reasons = { readonly [code: number]: (message: string) => Refusal }

const CREATE_REASONS: Reasons = {
  [METHOD_NOT_FOUND]: () => ({ kind: 'unsupported', message: "This Hermes can't create bots from Highwing." }),
  4061: message => ({ kind: 'rejected', message, field: 'name' }),
  4062: message => ({ kind: 'rejected', message, field: 'name' }),
  // Not a refusal of the request: Hermes may have failed after it made the profile.
  5062: message => ({ kind: 'rejected', message: `Hermes may not have finished making the bot: ${message}` })
}
const EDIT_REASONS: Reasons = {
  [METHOD_NOT_FOUND]: () => ({ kind: 'unsupported', message: "This Hermes can't edit bots from Highwing." })
}
const PICTURE_REASONS: Reasons = {
  ...EDIT_REASONS,
  ...Object.fromEntries([4067, 4068, 4069, 4070].map(code => [code, () => ({ kind: 'rejected', message: PICTURE_RULE })]))
}

const DRAW_REASONS: Reasons = {
  [METHOD_NOT_FOUND]: () => ({ kind: 'unsupported', message: "This Hermes can't draw pictures." }),
  4071: () => ({ kind: 'rejected', message: 'Describe the picture first.' }),
  5071: message => ({ kind: 'rejected', message: `Hermes couldn't draw that picture: ${message}` })
}
const PET_REASONS: Reasons = {
  [METHOD_NOT_FOUND]: () => ({ kind: 'unsupported', message: "This Hermes can't list pets." })
}

const GONE: Outcome<never> = { ok: false, refusal: { kind: 'rejected', message: 'Hermes no longer has this bot.' } }
const CLASH: Outcome<never> = { ok: false, refusal: { kind: 'conflict', message: 'This bot changed elsewhere.' } }
const DONE: Outcome = { ok: true, value: undefined }

export async function guarded<T>(reasons: Reasons, work: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof Offline) return NOT_CONNECTED
    return { ok: false, refusal: error instanceof RpcRefusal ? reasons[error.code]?.(error.message) ?? refusalOf(error) : refusalOf(error) }
  }
}

function createParams({ name, description, model, persona }: BotDraft) {
  return {
    name: name.trim(),
    ...(description.trim() === '' ? {} : { description: description.trim() }),
    ...(persona.trim() === '' ? {} : { soul: persona }),
    ...(model === null ? {} : { model: model.id, provider: model.provider })
  }
}

/** Hermes copies the launch profile's credentials into the new bot unless told not to, so a new bot has a provider. */
export async function createBot(conn: Wire, draft: BotDraft, picture: string | null): Promise<Outcome<BotCreated>> {
  const made = await guarded(CREATE_REASONS, async () => ({ ok: true, value: parseCreated(await conn.call('profiles.create', createParams(draft))) }))
  if (!made.ok || picture === null) return made
  const set = await setBotPicture(conn, made.value.bot, picture)
  return set.ok ? made : { ok: true, value: { ...made.value, warnings: [...made.value.warnings, `its picture wasn't saved. ${set.refusal.message}`] } }
}

/** With no session Hermes reads the profile's own config (tui_gateway/methods_complete.py:297-299, :320-334), so a bot with no chat has a list. */
export const botModels = (conn: Wire, bot: BotId | null): Promise<Outcome<ModelMenu>> =>
  guarded({}, async () => ({ ok: true, value: parseModelMenu(await (bot === null ? conn : conn.as(bot)).call('model.options', { explicit_only: true })) }))

/** With no session `config.get full` reads the profile's own config.yaml (gateway/session_config.py:65-115). */
export const denyRules = (conn: Wire, bot: BotId | null): Promise<Outcome<readonly string[]>> =>
  guarded({}, async () => ({ ok: true, value: parseDenyRules(await (bot === null ? conn : conn.as(bot)).call('config.get', { key: 'full' })) }))

const LIST_ROWS = { include_sessions: false } as const

export const describeBot = (conn: Wire, bot: BotId): Promise<Outcome<BotDetails>> =>
  guarded(EDIT_REASONS, async () => {
    const [described, listed] = await Promise.all([conn.call('profiles.describe', { name: bot }), conn.call('profiles.list', LIST_ROWS)])
    const details = parseDetails(described, listed, bot)
    return details === null ? GONE : { ok: true, value: details }
  })

const SECTION_WORDS: { readonly [section: string]: string } = { ui_meta: 'name', description: 'description', soul: 'persona' }

const inWords = (items: readonly string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

const unsaved = (sections: readonly string[]): Outcome =>
  ({ ok: false, refusal: { kind: 'rejected', message: `Hermes didn't save the ${inWords(sections.map(section => SECTION_WORDS[section] ?? section))}.` } })

function edited(configured: Configured, sent: readonly string[]): Outcome {
  switch (configured.is) {
    case 'saved': return DONE
    case 'clash': return CLASH
    case 'unsaved': return unsaved(configured.sections)
    case 'unreported': return unsaved(sent)
  }
}

/**
 * Hermes replaces the Bots plugin's record whole, so a write is the record as Hermes holds it now with `patch` on
 * top. `revision` is the one the record was read at, so a write made elsewhere since is refused; null for a Hermes
 * that keeps no revisions.
 */
function recordWrite(meta: { readonly [key: string]: unknown }, patch: { readonly [key: string]: unknown }, revision: number | null) {
  // Hermes's own Bots plugin drops `chat` on every write of the record (hermes-bots/data.ts:388).
  const kept = Object.fromEntries(Object.entries(meta).filter(([key]) => key !== 'chat'))
  return {
    ui_meta: { 'hermes-bots': { ...kept, ...patch } },
    ...(revision === null ? {} : { ui_meta_expected_revisions: { 'hermes-bots': revision } })
  }
}

/** The name shown is the Bots plugin's `title`, not the profile's name, which stays the bot's id. */
async function renamed(conn: Wire, bot: BotId, name: string, revision: number | null) {
  const record = parseBotRecord(await conn.call('profiles.list', LIST_ROWS), bot)
  return record === null ? null : recordWrite(record.meta, { title: name.trim() }, revision)
}

export const editBot = (conn: Wire, bot: BotId, { name, description, persona }: BotEdit, revision: number | null): Promise<Outcome> =>
  guarded(EDIT_REASONS, async () => {
    const rename = name === undefined ? {} : await renamed(conn, bot, name, revision)
    if (rename === null) return GONE
    const params = { name: bot, ...rename, ...(description === undefined ? {} : { description }), ...(persona === undefined ? {} : { soul: persona }) }
    const sent = Object.keys(SECTION_WORDS).filter(section => section in params)
    return edited(parseConfigured(await conn.call('profiles.configure', params), sent), sent)
  })

const NO_CHANGES: Refusal = { kind: 'unsupported', message: "This Hermes can't change bots from Highwing." }
const MARK_REASONS: Reasons = { [METHOD_NOT_FOUND]: () => NO_CHANGES }
const MARK_ATTEMPTS = 3
const NO_PROFILE = 4064

const didnt = (kind: 'conflict' | 'rejected', mark: BotMark, name: string): Outcome<never> =>
  ({ ok: false, refusal: { kind, message: `Hermes didn't ${mark} ${name}. Try again.` } })

export const markBot = (conn: Wire, bot: BotId, mark: BotMark): Promise<Outcome> =>
  guarded(MARK_REASONS, async () => {
    const { flag, on } = MARK_SETS[mark]
    const read = async () => parseBotRecord(await conn.call('profiles.list', LIST_ROWS), bot)
    let name: string = bot
    for (let attempt = 0; attempt < MARK_ATTEMPTS; attempt++) {
      const record = await read()
      if (record === null) return GONE
      name = record.name
      const reply = await conn.call('profiles.configure', { name: bot, ...recordWrite(record.meta, { [flag]: on }, record.revision) }).catch(async (error: unknown) => {
        // Hermes also answers 4064 when the profile or its config is unavailable, so only a read that misses the bot means it is gone.
        if (error instanceof RpcRefusal && error.code === NO_PROFILE && (await read()) === null) return null
        throw error
      })
      if (reply === null) return GONE
      const configured = parseConfigured(reply, ['ui_meta'])
      switch (configured.is) {
        case 'saved': return DONE
        case 'clash': continue
        case 'unsaved': return didnt('rejected', mark, name)
        case 'unreported': return { ok: false, refusal: NO_CHANGES }
      }
    }
    return didnt('conflict', mark, name)
  })

export const setBotPicture = (conn: Wire, bot: BotId, data: string | null): Promise<Outcome> =>
  guarded(PICTURE_REASONS, async () => {
    await conn.call('profiles.set_asset', data === null ? { name: bot, asset: 'avatar', clear: true } : { name: bot, asset: 'avatar', data })
    return DONE
  })

export const botPicture = (conn: Wire, bot: BotId): Promise<Outcome<string | null>> =>
  guarded(EDIT_REASONS, async () => ({ ok: true, value: parsePicture(await conn.call('profiles.get_asset', { name: bot, asset: 'avatar' })) }))

export const canGeneratePicture = (conn: Wire): Promise<Outcome<boolean>> =>
  guarded({}, async () => {
    try {
      return { ok: true, value: parseImageProbe(await conn.call('image.generate', { probe: true })) }
    } catch (error) {
      if (error instanceof RpcRefusal && error.code === METHOD_NOT_FOUND) return { ok: true, value: false }
      throw error
    }
  })

export const generatePicture = (conn: Wire, prompt: string): Promise<Outcome<string>> =>
  guarded(DRAW_REASONS, async () => parseGenerated(await conn.call('image.generate', { prompt, aspect_ratio: 'square', max_bytes: GENERATED_MAX_BYTES })))

export const listPets = (conn: Wire): Promise<Outcome<readonly PetChoice[]>> =>
  guarded(PET_REASONS, async () => ({ ok: true, value: parsePets(await conn.call('pet.gallery', {})) }))

const SKILL_REASONS: Reasons = { [METHOD_NOT_FOUND]: () => ({ kind: 'unsupported', message: "This Hermes can't list skills from Highwing." }), [NO_PROFILE]: () => GONE.refusal }

type SkillWire = Pick<Connection, 'call' | 'as' | 'home'>

const UNNAMED: Outcome<never> = { ok: false, refusal: { kind: 'unsupported', message: "This Hermes doesn't say which bot it runs as." } }

/** The bot the gateway runs as. `profiles.describe` needs a name, so `bot` null reads that one. */
const launchBot = async (conn: SkillWire): Promise<BotId | null> =>
  conn.home === null ? null : parseBotAt(await conn.call('profiles.list', LIST_ROWS), conn.home)

/** `learning.detail` takes only an id and reads the gateway's own profile (agent/learning_mutations.py:151-159), so only the launch bot's skills can be read. */
const skillMarkdown = async (conn: SkillWire, name: string): Promise<string> => parseSkillText(await conn.call('learning.detail', { id: name })) ?? ''

/** A skill's description is the catalog's, which lists enabled skills only. One the catalog skips (a disabled one) has the `description:` of its own SKILL.md on the launch bot, and none on another. */
export const readSkills = (conn: SkillWire, bot: BotId | null): Promise<Outcome<readonly Skill[]>> =>
  guarded(SKILL_REASONS, async () => {
    const [launch, catalog] = await Promise.all([
      launchBot(conn),
      (bot === null ? conn : conn.as(bot)).call('commands.catalog', {}).then(parseCatalog).catch(() => [])
    ])
    const profile = bot ?? launch
    if (profile === null) return UNNAMED
    const described = await conn.call('profiles.describe', { name: profile })
    const said = new Map(catalog.flatMap(entry => (entry.kind === 'skill' ? [[entry.name.toLowerCase(), entry.description] as const] : [])))
    const skills = await Promise.all(parseSkillStates(described).map(async ({ name, enabled }) => ({
      name, enabled, description: said.get(name.toLowerCase()) ?? (profile === launch ? descriptionOf(await skillMarkdown(conn, name).catch(() => '')) : '')
    })))
    return { ok: true, value: skills.sort((a, b) => a.name.localeCompare(b.name)) }
  })

export const skillText = (conn: SkillWire, bot: BotId | null, name: string): Promise<Outcome<string>> =>
  guarded({}, async () => {
    const launch = await launchBot(conn)
    if (launch === null || (bot ?? launch) !== launch) return { ok: false, refusal: { kind: 'unsupported', message: "This Hermes can show only the SKILL.md files of the bot it runs as." } }
    const text = parseSkillText(await conn.call('learning.detail', { id: name }))
    return text === null ? { ok: false, refusal: { kind: 'rejected', message: `Hermes has no SKILL.md for ${name}.` } } : { ok: true, value: text }
  })

const SKILL_GONE: Outcome<never> = { ok: false, refusal: { kind: 'rejected', message: 'Hermes no longer has this skill.' } }

/**
 * Hermes replaces the profile's disabled list whole, so it is sent as the list Hermes gives now with this one skill moved.
 * Hermes saves an essential skill as on and still says it saved (hermes_cli/skills_config.py:43-47), so the skill is read back.
 */
export const setSkill = (conn: SkillWire, bot: BotId | null, name: string, enabled: boolean): Promise<Outcome> =>
  guarded(SKILL_REASONS, async () => {
    const profile = bot ?? await launchBot(conn)
    if (profile === null) return UNNAMED
    const states = async () => parseSkillStates(await conn.call('profiles.describe', { name: profile }))
    const skills = await states()
    if (!skills.some(skill => skill.name === name)) return SKILL_GONE
    const disabled = skills.filter(skill => (skill.name === name ? !enabled : !skill.enabled)).map(skill => skill.name)
    const configured = parseConfigured(await conn.call('profiles.configure', { name: profile, disabled_skills: disabled }), ['skills'])
    const kept = configured.is === 'saved' && (await states()).find(skill => skill.name === name)?.enabled === enabled
    return kept ? DONE : { ok: false, refusal: { kind: 'rejected', message: `Hermes kept ${name} ${enabled ? 'off' : 'on'}.` } }
  })

/** Hermes fetches a sheet only from petdex (agent/pet/store.py:240), so a `url` the window names reaches no other host. */
export const petPicture = (conn: Wire, slug: string, url: string | null): Promise<Outcome<string | null>> =>
  guarded(PET_REASONS, async () => ({ ok: true, value: parsePetPicture(await conn.call('pet.thumb', url === null ? { slug } : { slug, url })) }))

/** Hermes answers every vault failure with 5095 and its own words, such as the manager tool's reason an unlock failed. */
const VAULT_REASONS: Reasons = {
  [METHOD_NOT_FOUND]: () => ({ kind: 'unsupported', message: "This Hermes can't set up password managers from Highwing." }),
  5095: message => ({ kind: 'rejected', message })
}

type PasswordCommand = Extract<Command, { do: 'passwordManagers' | 'usePasswordManager' | 'unlockPasswordManager' | 'lockPasswordManager' }>

function change(calls: ReturnType<Wire['as']>, command: PasswordCommand): Promise<unknown> | null {
  switch (command.do) {
    case 'passwordManagers': return null
    case 'usePasswordManager': return calls.call('vault.source.set', { name: command.manager, enabled: command.use })
    case 'unlockPasswordManager': return calls.call('vault.unlock', { name: command.manager, password: command.password })
    case 'lockPasswordManager': return calls.call('vault.lock', { name: command.manager })
  }
}

/** `vault.list` can launch Chrome for the browser login source (tui_gateway/methods_vault.py:230-234), so it is asked only to count an unlocked manager's logins. */
async function loginsOf(calls: ReturnType<Wire['as']>) {
  try {
    return await calls.call('vault.list', {})
  } catch (error) {
    if (error instanceof RpcRefusal) return null
    throw error
  }
}

export const passwordManagers = (conn: Wire, command: PasswordCommand): Promise<Outcome<BotManagers>> =>
  guarded(VAULT_REASONS, async () => {
    const calls = conn.as(command.bot)
    await change(calls, command)
    const sources = await calls.call('vault.sources', {})
    const uncounted = parseBotManagers(command.bot, sources, null)
    if (!uncounted.managers.some(manager => manager.state.at === 'ready')) return { ok: true, value: uncounted }
    return { ok: true, value: parseBotManagers(command.bot, sources, await loginsOf(calls)) }
  })

const NO_TOOL_SERVERS: Refusal = { kind: 'unsupported', message: "This Hermes can't manage tool servers from Highwing." }
const SERVER_TAKEN = 4090
const NO_SERVER = 4064
const LIST_REASONS: Reasons = { [METHOD_NOT_FOUND]: () => NO_TOOL_SERVERS }
const ADD_REASONS: Reasons = {
  ...LIST_REASONS,
  [SERVER_TAKEN]: () => ({ kind: 'rejected', message: "There's already a tool server with that name.", field: 'name' }),
  // 4001 is also how Hermes refuses a call it cannot read, so only the safety check gets its own words.
  4001: message => ({ kind: 'rejected', message: /suspicious/.test(message) ? "Hermes won't add that command because it looks unsafe to run." : `Hermes refused: ${message}` }),
  4063: () => ({ kind: 'rejected', message: 'Hermes needs a web address or a command to add a tool server.' })
}
const REMOVE_REASONS: Reasons = {
  ...LIST_REASONS,
  [SERVER_TAKEN]: () => ({ kind: 'rejected', message: 'A plugin provides that tool server, so only the plugin can remove it.' })
}

async function readServers(hermes: Pick<Connection, 'call'>): Promise<readonly ToolServer[]> {
  const [listed, status] = await Promise.all([hermes.call('mcp.servers.list', {}), hermes.call('mcp.servers.status', {})])
  return parseToolServers(listed, status)
}

const scoped = (conn: Wire, bot: BotId | null) => (bot === null ? conn : conn.as(bot))

export const toolServers = (conn: Wire, bot: BotId | null): Promise<Outcome<readonly ToolServer[]>> =>
  guarded(LIST_REASONS, async () => ({ ok: true, value: await readServers(scoped(conn, bot)) }))

const configOf = (setup: ServerSetup) => setup.kind === 'address'
  ? { url: setup.url, ...(setup.headers.length === 0 ? {} : { headers: Object.fromEntries(setup.headers.map(({ name, value }) => [name, value])) }) }
  : { command: setup.command, ...(setup.args.length === 0 ? {} : { args: [...setup.args] }) }

const dropServer = (hermes: Pick<Connection, 'call'>, name: string) => hermes.call('mcp.servers.remove', { name })

/** `mcp.servers.test` probes only a saved server, so a server that fails the probe, or that could not be probed, is taken out again. */
async function probed(hermes: Pick<Connection, 'call'>, name: string): Promise<Tested> {
  const tested = await hermes.call('mcp.servers.test', { name }).then(parseTested, async (error: unknown) => {
    await dropServer(hermes, name).catch(() => undefined)
    throw error
  })
  if (!tested.ok) await dropServer(hermes, name)
  return tested
}

export const addToolServer = (conn: Wire, bot: BotId | null, setup: ServerSetup): Promise<Outcome<Added>> =>
  guarded(ADD_REASONS, async () => {
    const hermes = scoped(conn, bot)
    await hermes.call('mcp.servers.add', { name: setup.name, config: configOf(setup) })
    const tested = await probed(hermes, setup.name)
    return { ok: true, value: { tested, servers: await readServers(hermes) } }
  })

const PLUGIN_REASONS: Reasons = { [METHOD_NOT_FOUND]: () => ({ kind: 'unsupported', message: "This Hermes can't list its plugins." }) }

export const listPlugins = (conn: Wire, bot: BotId | null): Promise<Outcome<readonly Plugin[]>> =>
  guarded(PLUGIN_REASONS, async () => ({ ok: true, value: parsePlugins(await scoped(conn, bot).call('plugins.manage', { action: 'list' })) }))

export const removeToolServer = (conn: Wire, bot: BotId | null, name: string): Promise<Outcome<readonly ToolServer[]>> =>
  guarded(REMOVE_REASONS, async () => {
    const hermes = scoped(conn, bot)
    await dropServer(hermes, name).catch((error: unknown) => {
      if (!(error instanceof RpcRefusal && error.code === NO_SERVER)) throw error
    })
    return { ok: true, value: await readServers(hermes) }
  })

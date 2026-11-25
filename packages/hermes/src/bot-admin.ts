import { refusalOf } from './actor'
import { GENERATED_MAX_BYTES, PICTURE_RULE, type BotCreated, type BotDetails, type BotDraft, type BotEdit, type BotId, type PetChoice } from './domain/bots'
import type { ModelMenu, Outcome, Refusal } from './domain/command'
import { NOT_CONNECTED } from './open'
import { METHOD_NOT_FOUND, Offline, RpcRefusal, type Connection } from './wire/link'
import {
  parseBotRecord, parseConfigured, parseCreated, parseDetails, parseGenerated, parseImageProbe, parseModelMenu, parsePetPicture, parsePets, parsePicture, type Configured
} from './wire/parse'

type Wire = Pick<Connection, 'call' | 'as'>
type Reasons = { readonly [code: number]: (message: string) => Refusal }

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

async function guarded<T>(reasons: Reasons, work: () => Promise<Outcome<T>>): Promise<Outcome<T>> {
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

/**
 * Hermes copies the launch profile's credentials into the new bot unless told not to, so a new bot has a provider. The bot
 * exists once Hermes made it, so a picture it then refuses is one more warning rather than a refusal of the create.
 */
export async function createBot(conn: Wire, draft: BotDraft, picture: string | null): Promise<Outcome<BotCreated>> {
  const made = await guarded(CREATE_REASONS, async () => ({ ok: true, value: parseCreated(await conn.call('profiles.create', createParams(draft))) }))
  if (!made.ok || picture === null) return made
  const set = await setBotPicture(conn, made.value.bot, picture)
  return set.ok ? made : { ok: true, value: { ...made.value, warnings: [...made.value.warnings, `its picture wasn't saved. ${set.refusal.message}`] } }
}

/** With no session Hermes reads the profile's own config (tui_gateway/methods_complete.py:297-299, :320-334), so a bot with no chat has a list. */
export const botModels = (conn: Wire, bot: BotId | null): Promise<Outcome<ModelMenu>> =>
  guarded({}, async () => ({ ok: true, value: parseModelMenu(await (bot === null ? conn : conn.as(bot)).call('model.options', { explicit_only: true })) }))

const LIST_ROWS = { include_sessions: false } as const

export const describeBot = (conn: Wire, bot: BotId): Promise<Outcome<BotDetails>> =>
  guarded(EDIT_REASONS, async () => {
    const [described, listed] = await Promise.all([conn.call('profiles.describe', { name: bot }), conn.call('profiles.list', LIST_ROWS)])
    const details = parseDetails(described, listed, bot)
    return details === null ? GONE : { ok: true, value: details }
  })

const SECTION_WORDS: { readonly [section: string]: string } = { ui_meta: 'name', description: 'description', soul: 'persona' }

const inWords = (items: readonly string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`)

function edited(configured: Configured): Outcome {
  switch (configured.is) {
    case 'saved': return DONE
    case 'clash': return CLASH
    case 'unsaved': return { ok: false, refusal: { kind: 'rejected', message: `Hermes didn't save the ${inWords(configured.sections.map(section => SECTION_WORDS[section] ?? section))}.` } }
  }
}

/**
 * The name shown is the Bots plugin's `title`, not the profile's name, which stays the bot's id. Hermes replaces
 * the plugin's record whole, so a rename writes the record as Hermes holds it now with the new title.
 */
async function renamed(conn: Wire, bot: BotId, name: string, revision: number | null) {
  const record = parseBotRecord(await conn.call('profiles.list', LIST_ROWS), bot)
  if (record === null) return null
  // Hermes's own Bots plugin drops `chat` on every write of the record (hermes-bots/data.ts:388).
  const kept = Object.fromEntries(Object.entries(record.meta).filter(([key]) => key !== 'chat'))
  return {
    ui_meta: { 'hermes-bots': { ...kept, title: name.trim() } },
    ...(revision === null ? {} : { ui_meta_expected_revisions: { 'hermes-bots': revision } })
  }
}

export const editBot = (conn: Wire, bot: BotId, { name, description, persona }: BotEdit, revision: number | null): Promise<Outcome> =>
  guarded(EDIT_REASONS, async () => {
    const rename = name === undefined ? {} : await renamed(conn, bot, name, revision)
    if (rename === null) return GONE
    const params = { name: bot, ...rename, ...(description === undefined ? {} : { description }), ...(persona === undefined ? {} : { soul: persona }) }
    const sent = Object.keys(SECTION_WORDS).filter(section => section in params)
    return edited(parseConfigured(await conn.call('profiles.configure', params), sent))
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
      // A Hermes without the call has no image model to offer, which is no refusal.
      if (error instanceof RpcRefusal && error.code === METHOD_NOT_FOUND) return { ok: true, value: false }
      throw error
    }
  })

export const generatePicture = (conn: Wire, prompt: string): Promise<Outcome<string>> =>
  guarded(DRAW_REASONS, async () => parseGenerated(await conn.call('image.generate', { prompt, aspect_ratio: 'square', max_bytes: GENERATED_MAX_BYTES })))

export const listPets = (conn: Wire): Promise<Outcome<readonly PetChoice[]>> =>
  guarded(PET_REASONS, async () => ({ ok: true, value: parsePets(await conn.call('pet.gallery', {})) }))

/** Hermes fetches a sheet only from petdex (agent/pet/store.py:240), so a `url` the window names reaches no other host. */
export const petPicture = (conn: Wire, slug: string, url: string | null): Promise<Outcome<string | null>> =>
  guarded(PET_REASONS, async () => ({ ok: true, value: parsePetPicture(await conn.call('pet.thumb', url === null ? { slug } : { slug, url })) }))

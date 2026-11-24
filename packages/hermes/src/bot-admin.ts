import { refusalOf } from './actor'
import type { BotCreated, BotDraft, BotId } from './domain/bots'
import type { ModelMenu, Outcome, Refusal } from './domain/command'
import { NOT_CONNECTED } from './open'
import { METHOD_NOT_FOUND, Offline, RpcRefusal, type Connection } from './wire/link'
import { parseCreated, parseModelMenu } from './wire/parse'

type Wire = Pick<Connection, 'call' | 'as'>

const REASONS: { readonly [code: number]: (message: string) => Refusal } = {
  [METHOD_NOT_FOUND]: () => ({ kind: 'unsupported', message: "This Hermes can't create bots from Highwing." }),
  4061: message => ({ kind: 'rejected', message, field: 'name' }),
  4062: message => ({ kind: 'rejected', message, field: 'name' }),
  // Not a refusal of the request: Hermes may have failed after it made the profile.
  5062: message => ({ kind: 'rejected', message: `Hermes may not have finished making the bot: ${message}` })
}

const refusalOfCreate = (error: unknown): Refusal =>
  error instanceof RpcRefusal ? REASONS[error.code]?.(error.message) ?? refusalOf(error) : refusalOf(error)

function createParams({ name, description, model, persona }: BotDraft) {
  return {
    name: name.trim(),
    ...(description.trim() === '' ? {} : { description: description.trim() }),
    ...(persona.trim() === '' ? {} : { soul: persona }),
    ...(model === null ? {} : { model: model.id, provider: model.provider })
  }
}

/** Hermes copies the launch profile's credentials into the new bot unless told not to, so a new bot has a provider. */
export async function createBot(conn: Wire, draft: BotDraft): Promise<Outcome<BotCreated>> {
  try {
    return { ok: true, value: parseCreated(await conn.call('profiles.create', createParams(draft))) }
  } catch (error) {
    return error instanceof Offline ? NOT_CONNECTED : { ok: false, refusal: refusalOfCreate(error) }
  }
}

/** With no session Hermes reads the profile's own config (tui_gateway/methods_complete.py:297-299, :320-334), so a bot with no chat has a list. */
export async function botModels(conn: Wire, bot: BotId | null): Promise<Outcome<ModelMenu>> {
  try {
    const reply = await (bot === null ? conn : conn.as(bot)).call('model.options', { explicit_only: true })
    return { ok: true, value: parseModelMenu(reply) }
  } catch (error) {
    return error instanceof Offline ? NOT_CONNECTED : { ok: false, refusal: refusalOf(error) }
  }
}

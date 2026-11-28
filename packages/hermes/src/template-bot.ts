import { createBot, guarded, type Reasons, type Wire } from './bot-admin'
import type { BotCreated, BotId } from './domain/bots'
import type { SetupStep, TemplatePlan } from './domain/bot-templates'
import type { Outcome } from './domain/command'
import { listRoutines } from './routines'
import { METHOD_NOT_FOUND } from './wire/link'
import { parseAdded, parseConfigured } from './wire/parse'

const DONE: Outcome = { ok: true, value: undefined }
const unsupported = (message: string): Reasons => ({ [METHOD_NOT_FOUND]: () => ({ kind: 'unsupported', message }) })

const NO_TOOLSETS = unsupported("This Hermes can't turn on a bot's tools from Highwing.")
const NO_APPROVALS = unsupported("This Hermes can't set a bot's approval mode from Highwing.")
const NO_JOBS = unsupported("This Hermes can't schedule jobs from Highwing.")

const FAILED: { readonly [K in SetupStep['step']]: string } = {
  toolsets: "its tools weren't turned on",
  approval: "its approval mode wasn't set",
  job: "the nightly job wasn't added"
}

/** Each step ends in the same state when run again: Hermes replaces a profile's toolsets and approval mode, and a job is added only when the bot has none of that name. */
function setUp(conn: Wire, bot: BotId, step: SetupStep): Promise<Outcome> {
  switch (step.step) {
    case 'toolsets':
      return guarded(NO_TOOLSETS, async () => {
        const configured = parseConfigured(await conn.call('profiles.configure', { name: bot, enabled_toolsets: [...step.toolsets] }), ['toolsets'])
        return configured.is === 'saved' ? DONE : { ok: false, refusal: { kind: 'rejected', message: "Hermes didn't save the tools." } }
      })
    case 'approval':
      return guarded(NO_APPROVALS, async () => {
        await conn.as(bot).call('config.set', { key: 'approval_mode', value: step.mode })
        return DONE
      })
    case 'job':
      return guarded(NO_JOBS, async () => {
        const held = await listRoutines(conn, bot)
        if (held.ok && held.value.some(routine => routine.name === step.name)) return DONE
        const { name, schedule, prompt, deliver } = step
        return parseAdded(await conn.as(bot).call('cron.manage', { action: 'add', name, schedule, prompt, deliver }))
      })
  }
}

/**
 * Makes the profile with `picture`, then each setup step in order. A profile Hermes refuses ends the run with createBot's refusal, and nothing else is sent.
 * Once the bot exists, a step that fails does not stop the ones after it. Each failure is a warning, as createBot's picture is.
 */
export async function createFromTemplate(conn: Wire, [create, ...setup]: TemplatePlan, picture: string): Promise<Outcome<BotCreated>> {
  const made = await createBot(conn, { name: create.name, description: create.description, model: null, persona: create.soul }, picture)
  if (!made.ok) return made
  const warnings = [...made.value.warnings]
  for (const step of setup) {
    const done = await setUp(conn, made.value.bot, step)
    if (!done.ok) warnings.push(`${FAILED[step.step]}. ${done.refusal.message}`)
  }
  return { ok: true, value: { ...made.value, warnings } }
}

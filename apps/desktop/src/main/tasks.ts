import type { AskHermes } from '@highwing/hermes'
import { BOARD_PATH, parseTaskBoard, parseTaskChat, taskPath, type CommandOutcome, type Refusal, type TaskBoard, type TaskChat } from '@highwing/hermes/domain'

const refused = (kind: Refusal['kind'], message: string) => ({ ok: false, refusal: { kind, message } }) as const
const NO_BOARD = refused('unsupported', 'This Hermes has no task board.')
const UNREACHABLE = refused('offline', "Highwing couldn't reach Hermes's task board.")
const UNREADABLE = refused('unsupported', "Hermes answered with a task board Highwing can't read.")
const NO_TASK = refused('stale', "That task isn't on the board any more.")

const answered = (ask: AskHermes, path: string) => ask({ method: 'GET', path, bot: null }).catch(() => null)

export async function readTaskBoard(ask: AskHermes): Promise<CommandOutcome<TaskBoard>> {
  const answer = await answered(ask, BOARD_PATH)
  if (answer?.status === 404) return NO_BOARD
  if (answer?.status !== 200) return UNREACHABLE
  const board = parseTaskBoard(answer.body)
  return board === null ? UNREADABLE : { ok: true, value: board }
}

export async function readTaskChat(ask: AskHermes, id: string): Promise<CommandOutcome<TaskChat | null>> {
  const answer = await answered(ask, taskPath(id))
  if (answer?.status === 404) return NO_TASK
  if (answer?.status !== 200) return UNREACHABLE
  const chat = parseTaskChat(answer.body)
  return chat === 'invalid' ? UNREADABLE : { ok: true, value: chat }
}

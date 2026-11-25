import type { BackgroundProcess, ControlAction, Goal, GoalVerdict, Heartbeat, Loop, SessionControl } from '@highwing/hermes/domain'

export type Card = keyof SessionControl

/** A card's button. `ask`: the question a press must answer yes to first. */
export interface Press {
  readonly words: 'Pause' | 'Resume' | 'Clear' | 'Stop'
  readonly act: Exclude<ControlAction['act'], 'subgoal.add' | 'subgoal.remove'>
  readonly ask: string | null
}

const ENDS = {
  goal: { words: 'Clear', act: 'goal.clear', ask: 'Clear the goal? Hermes can’t bring it back.' },
  loop: { words: 'Stop', act: 'loop.stop', ask: 'Stop the loop?' },
  heartbeat: { words: 'Clear', act: 'heartbeat.clear', ask: 'Clear the heartbeat?' }
} as const satisfies Record<Card, Press>

/** The buttons Hermes serves for a card in this state (gateway/session_control_actions.py:15-22). */
export function pressesOf(card: Card, status: Goal['status'] | Loop['status'] | Heartbeat['status']): readonly Press[] {
  const toggle: readonly Press[] = status === 'active'
    ? [{ words: 'Pause', act: `${card}.pause`, ask: null }]
    : status === 'paused' ? [{ words: 'Resume', act: `${card}.resume`, ask: null }] : []
  return [...toggle, ENDS[card]]
}

const running = (process: BackgroundProcess) => process.state.s === 'running'

export function processesWords(processes: readonly BackgroundProcess[]): string {
  const live = processes.filter(running).length
  return live > 0 ? `${live} running in the background` : `${processes.length} ended in the background`
}

/** Hermes's ends other than a plain exit (tools/process_registry.py:560). */
const ENDED: Readonly<Record<string, string>> = { killed: 'Stopped', lost: 'Lost' }

export function processState({ state }: BackgroundProcess): string {
  if (state.s === 'running') return 'Running'
  return (state.why === null ? undefined : ENDED[state.why]) ?? (state.code === null ? 'Exited' : `Exited ${state.code}`)
}

const GOAL_STATUS = { active: 'Working', paused: 'Paused', done: 'Done' } as const satisfies Record<Goal['status'], string>

export function goalParts(goal: Goal): readonly string[] {
  const { used, max } = goal.turns
  const state = goal.verdict?.is === 'blocked' ? 'Blocked' : goal.waiting !== null ? 'Waiting' : GOAL_STATUS[goal.status]
  return [max > 0 ? `Turn ${used} of ${max}` : `Turn ${used}`, state]
}

export const VERDICT_WORDS = {
  done: 'Met', blocked: 'Blocked', continue: 'Not met yet', wait: 'Waiting', skipped: 'Skipped'
} as const satisfies Record<GoalVerdict, string>

/** "30 s", "5 min", "2 h", "1 h 30 min". */
export function every(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return [hours > 0 && `${hours} h`, minutes > 0 && `${minutes} min`, (rest > 0 || seconds === 0) && `${rest} s`].filter(Boolean).join(' ')
}

const pad = (value: number) => String(value).padStart(2, '0')

/** Counts down on this client's clock to Hermes's `nextAt`: "Next in 4:05", "Next in 1:02:05", then "Due". */
export function countdown(nextAt: number, now: number): string {
  const left = Math.ceil((nextAt - now) / 1000)
  if (left <= 0) return 'Due'
  const hours = Math.floor(left / 3600)
  const minutes = Math.floor((left % 3600) / 60)
  return `Next in ${hours > 0 ? `${hours}:${pad(minutes)}` : minutes}:${pad(left % 60)}`
}

/** Whether the loop's header counts down, and so needs the clock to tick. */
export const countsDown = (loop: Loop) => loop.status === 'active' && !loop.heldByGoal && loop.nextAt !== null

export function loopParts(loop: Loop, now: number): readonly string[] {
  const cadence = loop.mode === 'self-paced' ? 'Self-paced' : `Every ${every(loop.everyS)}`
  const state = loop.heldByGoal ? 'Waiting for the goal'
    : loop.status === 'paused' ? 'Paused'
    : loop.status === 'done' ? 'Done'
    : loop.nextAt === null ? null : countdown(loop.nextAt, now)
  return state === null ? [cadence] : [cadence, state]
}

export function heartbeatParts(heartbeat: Heartbeat): readonly string[] {
  const cadence = `Every ${every(heartbeat.everyS)}`
  return heartbeat.status === 'paused' ? [cadence, 'Paused'] : [cadence]
}

export function ranWords(fired: number, max: number): string {
  return max > 0 ? `Ran ${fired} of ${max} times` : `Ran ${fired} ${fired === 1 ? 'time' : 'times'}`
}

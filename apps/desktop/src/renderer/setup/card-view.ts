import { failureOf, machineOf, STEP_WORDS, type Link, type Target } from '@highwing/hermes/domain'
import { bannerOf, type BannerAction } from '../chrome/Chrome'
import { SIGN_IN_HINT } from './form'
import type { CardSetup } from './screens'

/** The row that says who Highwing talks to now. */
export interface Summary {
  readonly kind: Target['kind']
  readonly title: string
  /** The host or address as saved, when it says more than the title: a full tailnet name, a `user@`, or an address's scheme and port. */
  readonly host: string | null
  /** The link's own words while it waits or is blocked. They take the host's place. */
  readonly said: string | null
  readonly online: boolean
  readonly action: BannerAction | null
}

/** The footer's left slot. A first run has no note, so it shows nothing until a check runs. */
export type Foot = { readonly show: 'note' } | { readonly show: 'progress'; readonly words: string } | { readonly show: 'nothing' }

export interface Editor {
  /** What the draft starts from when the editor opens. */
  readonly seed: Target | null
  readonly disabled: boolean
  readonly problem: { readonly words: string; readonly fix: string } | null
  readonly foot: Foot
  /** Said under the fields while the check waits for a sign-in in the browser. */
  readonly hint: string | null
  /**
   * `stop` asks main to end the check. `off` is the save step, which main will not cancel. A first run has no Cancel, only
   * `stop-waiting` while it waits for a sign-in, which ends the check as a failure.
   */
  readonly cancel: 'fold' | 'stop' | 'off' | 'stop-waiting' | null
}

export interface CardView {
  /** null on a first run, which has no connection to sum up. */
  readonly summary: Summary | null
  /** null while folded. */
  readonly editor: Editor | null
  /** Said once a check from Settings passes. */
  readonly news: string | null
}

const NOTE: Foot = { show: 'note' }
const NOTHING: Foot = { show: 'nothing' }

// Settings is open already, and main refuses to open it again, which would stop the commands after it.
const inSettings = ({ label, run }: BannerAction): BannerAction => ({ label, run: run.filter(command => command.do !== 'editTarget') })

function summaryOf(target: Target, link: Link | undefined): Summary {
  const title = target.kind === 'local' ? 'This computer' : machineOf(target)
  const saved = target.kind === 'remote' ? target.host : target.kind === 'url' ? target.url : null
  const action = link === undefined ? null : (bannerOf(link, target)?.action ?? null)
  return {
    kind: target.kind,
    title,
    host: saved !== title ? saved : null,
    said: link?.state === 'waiting' || link?.state === 'blocked' ? link.message : null,
    online: link?.state === 'online',
    action: action && inSettings(action)
  }
}

/** `editing` is the window's own: whether Change opened the editor. A running or failed check always shows it. */
export function cardOf(setup: CardSetup, link: Link | undefined, editing: boolean): CardView {
  const first = setup.live === null
  const summary = setup.live === null ? null : summaryOf(setup.live.target, link)
  const atRest = (seed: Target | null): Editor | null =>
    (first || editing ? { seed, disabled: false, problem: null, foot: first ? NOTHING : NOTE, hint: null, cancel: first ? null : 'fold' } : null)
  switch (setup.at) {
    case 'form': return { summary, editor: atRest(setup.live?.target ?? null), news: null }
    case 'saved': return { summary, editor: atRest(setup.live.target), news: `Highwing now uses the Hermes on ${machineOf(setup.live.target)}.` }
    case 'checking': {
      const words = STEP_WORDS[setup.step](machineOf(setup.target))
      const signIn = setup.step === 'sign-in'
      const cancel = first ? (signIn ? 'stop-waiting' : null) : setup.step === 'save' ? 'off' : 'stop'
      return { summary, editor: { seed: setup.target, disabled: true, problem: null, foot: { show: 'progress', words }, hint: signIn ? SIGN_IN_HINT : null, cancel }, news: null }
    }
    case 'failed': {
      const failure = failureOf(setup.failure)
      const machine = machineOf(setup.target)
      const problem = { words: failure.words(machine), fix: failure.fix(machine) }
      return { summary, editor: { seed: setup.target, disabled: false, problem, foot: first ? NOTHING : NOTE, hint: null, cancel: first ? null : 'stop' }, news: null }
    }
  }
}

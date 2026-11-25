import { failureOf, machineOf, STEP_WORDS, type Link, type Target } from '@highwing/hermes/domain'
import { bannerOf, type BannerAction } from '../chrome/Chrome'
import { SIGN_IN_HINT } from './form'
import type { CardSetup } from './screens'

export interface Summary {
  readonly kind: Target['kind']
  readonly title: string
  readonly host: string | null
  readonly linkMessage: string | null
  readonly online: boolean
  readonly action: BannerAction | null
}

export type Foot = { readonly show: 'note' } | { readonly show: 'progress'; readonly words: string } | { readonly show: 'nothing' }

export interface Editor {
  readonly seed: Target | null
  readonly disabled: boolean
  readonly problem: { readonly words: string; readonly fix: string } | null
  readonly foot: Foot
  readonly hint: string | null
  readonly cancel: 'fold' | 'stop' | 'saving' | 'stop-waiting' | null
}

export interface CardView {
  readonly summary: Summary | null
  readonly editor: Editor | null
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
    linkMessage: link?.state === 'waiting' || link?.state === 'blocked' ? link.message : null,
    online: link?.state === 'online',
    action: action && inSettings(action)
  }
}

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
      const cancel = first ? (signIn ? 'stop-waiting' : null) : setup.step === 'save' ? 'saving' : 'stop'
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

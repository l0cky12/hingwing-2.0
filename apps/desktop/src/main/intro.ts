import type { Feed } from '@highwing/hermes'
import { DONE, DUE, EXAMPLES, nextIntro, OFF, type Intro, type IntroEvent } from '../intro'
import { feed } from './connection'
import { preferenceStore, type Preference } from './preferences'

type StoredIntro = Exclude<Intro['at'], 'off'>

export const isIntroPhase = (raw: unknown): raw is StoredIntro => raw === 'due' || raw === 'examples' || raw === 'done'

export const INTRO: Preference<StoredIntro, 'off'> = { file: 'intro.json', key: 'intro', is: isIntroPhase, fallback: 'off' }

const PHASE = { off: OFF, due: DUE, examples: EXAMPLES, done: DONE } as const

export interface IntroOwner {
  readonly intro: Feed<Intro>
  armIntro(): Promise<void>
  apply(event: IntroEvent): Promise<void>
  settled(): Promise<void>
}

export async function ownIntro(dir: string): Promise<IntroOwner> {
  const store = await preferenceStore(dir, INTRO)
  const intro = feed<Intro>(PHASE[store.get()])
  store.subscribe(phase => intro.set(PHASE[phase]))
  const commit = async (event: IntroEvent) => {
    const next = nextIntro(intro.get(), event)
    if (next === intro.get() || next.at === 'off') return
    await store.commit(next.at)
  }
  return { intro, armIntro: () => commit({ do: 'arm' }), apply: commit, settled: () => store.settled() }
}

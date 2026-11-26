import { machineOf, type BotId, type Shown, type ShownGroup, type Target } from '@highwing/hermes/domain'

export type Intro = { readonly at: 'off' } | { readonly at: 'due' } | { readonly at: 'examples' } | { readonly at: 'done' }

export type IntroEvent = { readonly do: 'arm' } | { readonly do: 'examples' } | { readonly do: 'done' }

export const OFF: Intro = { at: 'off' }
export const DUE: Intro = { at: 'due' }
export const EXAMPLES: Intro = { at: 'examples' }
export const DONE: Intro = { at: 'done' }

export function nextIntro(intro: Intro, event: IntroEvent): Intro {
  if (event.do === 'arm') return intro.at === 'off' ? DUE : intro
  if (event.do === 'examples') return intro.at === 'due' ? EXAMPLES : intro
  return intro.at === 'examples' ? DONE : intro
}

/** Enough of `Setup` to decide the cover, without importing the IPC contract. */
export type IntroPlace =
  | { readonly at: 'chat' | 'pinned' | 'form' | 'checking' | 'failed' }
  | { readonly at: 'saved'; readonly from: 'first-run' | 'settings' }

export function introInFront(setup: IntroPlace, intro: Intro): boolean {
  return intro.at === 'due' && (setup.at === 'chat' || (setup.at === 'saved' && setup.from === 'first-run'))
}

export interface IntroStep {
  readonly title: string
  readonly lead: string
  readonly primary: 'Next' | 'Open chat'
}

export function introSteps(target: Target): readonly [IntroStep, IntroStep, IntroStep] {
  return [
    {
      title: `Highwing now uses the Hermes on ${machineOf(target)}.`,
      lead: 'This Hermes has bots. A bot is a profile with its own chats, listed on the left. Highwing opens the default bot.',
      primary: 'Next'
    },
    {
      title: 'Each bot keeps its own chats.',
      lead: "Bot Chat is that bot's standing chat. New chat starts another with the same bot. Choosing a bot shows that bot's chats.",
      primary: 'Next'
    },
    {
      title: 'Start with the default bot.',
      lead: 'A few example requests sit above the message box. Choose one to send it, or write your own.',
      primary: 'Open chat'
    }
  ]
}

export const EXAMPLE_REQUESTS: readonly [string, string, string] = [
  'What can you help me with?',
  'Summarize what is in this folder.',
  'What should I do next?'
]

const NONE: readonly string[] = []

export type DefaultBot = { readonly at: 'pending' } | { readonly at: 'listed'; readonly id: BotId | null }

export function examplesFor(intro: Intro, shown: Shown | ShownGroup | null, featured: DefaultBot): readonly string[] {
  if (intro.at !== 'examples' || featured.at === 'pending' || shown === null || shown.kind === 'group') return NONE
  return featured.id === null || shown.bot === featured.id ? EXAMPLE_REQUESTS : NONE
}

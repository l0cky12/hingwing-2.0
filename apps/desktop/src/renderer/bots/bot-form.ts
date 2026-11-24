import { canonicalBotId, type BotDraft, type Bots, type ModelOption, type Refusal } from '@highwing/hermes/domain'

export const EMPTY_DRAFT: BotDraft = { name: '', description: '', model: null, persona: '' }

const idsOf = (bots: Bots | undefined): ReadonlySet<string> =>
  bots?.state === 'listed'
    ? new Set([bots.roster.featured, ...bots.roster.sections.flatMap(section => section.bots)].flatMap(bot => bot?.id ?? []))
    : new Set()

export function nameProblem(name: string, bots: Bots | undefined): string | null {
  if (/[/\\]/.test(name)) return "A name can't hold a slash."
  const id = canonicalBotId(name)
  return idsOf(bots).has(id) ? `There's already a bot called ${id}.` : null
}

export const canSubmit = (draft: BotDraft, problem: string | null): boolean => draft.name.trim() !== '' && problem === null

export type Send =
  | { readonly at: 'editing' }
  | { readonly at: 'sending' }
  | { readonly at: 'refused'; readonly refusal: Refusal }

export interface FormState {
  readonly draft: BotDraft
  readonly send: Send
}

export type FormEvent =
  | { readonly on: 'typed'; readonly draft: BotDraft }
  | { readonly on: 'sent' }
  | { readonly on: 'refused'; readonly refusal: Refusal }

const EDITING: Send = { at: 'editing' }

export const startForm = (draft: BotDraft): FormState => ({ draft, send: EDITING })

export function nextForm(state: FormState, event: FormEvent): FormState {
  switch (event.on) {
    case 'typed': {
      const { send } = state
      const outdated = send.at === 'refused' && (send.refusal.field !== 'name' || event.draft.name !== state.draft.name)
      return { draft: event.draft, send: outdated ? EDITING : send }
    }
    case 'sent':
      return { ...state, send: { at: 'sending' } }
    case 'refused':
      return { ...state, send: { at: 'refused', refusal: event.refusal } }
  }
}

export interface ModelGroup {
  readonly provider: string
  readonly label: string
  readonly options: readonly { readonly index: number; readonly option: ModelOption }[]
}

export function groupModels(options: readonly ModelOption[]): readonly ModelGroup[] {
  const groups = new Map<string, { label: string; options: { index: number; option: ModelOption }[] }>()
  options.forEach((option, index) => {
    const group = groups.get(option.provider) ?? { label: option.providerName, options: [] }
    group.options.push({ index, option })
    groups.set(option.provider, group)
  })
  return [...groups].map(([provider, { label, options: held }]) => ({ provider, label, options: held }))
}

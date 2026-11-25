import { canonicalBotId, type BotDetails, type BotDraft, type BotEdit, type BotId, type Bots, type CommandOutcome, type ModelOption, type Refusal } from '@highwing/hermes/domain'

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

export type Submitted = { readonly ok: true } | { readonly ok: false; readonly refusal: Refusal; readonly draft?: BotDraft }

export const draftOf = ({ name, description, persona }: BotDetails): BotDraft => ({ name, description, model: null, persona })

export function editOf(details: BotDetails, draft: BotDraft): BotEdit | null {
  const name = draft.name.trim()
  const edit: BotEdit = {
    ...(name === details.name ? {} : { name }),
    ...(draft.description === details.description ? {} : { description: draft.description }),
    ...(draft.persona === details.persona ? {} : { persona: draft.persona })
  }
  return Object.keys(edit).length === 0 ? null : edit
}

export interface EditCalls {
  readonly onDescribe: (bot: BotId) => Promise<CommandOutcome<BotDetails>>
  readonly onEdit: (bot: BotId, edit: BotEdit, revision: number | null) => Promise<CommandOutcome>
}

export async function saveEdit(details: BotDetails, draft: BotDraft, { onDescribe, onEdit }: EditCalls): Promise<{ readonly submitted: Submitted; readonly details: BotDetails }> {
  const edit = editOf(details, draft)
  if (edit === null) return { submitted: { ok: true }, details }
  const outcome = await onEdit(details.bot, edit, details.revision)
  if (outcome.ok || outcome.refusal.kind !== 'conflict') return { submitted: outcome, details }
  const fresh = await onDescribe(details.bot)
  return fresh.ok ? { submitted: { ...outcome, draft: draftOf(fresh.value) }, details: fresh.value } : { submitted: outcome, details }
}

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
  | { readonly on: 'refused'; readonly refusal: Refusal; readonly draft?: BotDraft }

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
      return { draft: event.draft ?? state.draft, send: { at: 'refused', refusal: event.refusal } }
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

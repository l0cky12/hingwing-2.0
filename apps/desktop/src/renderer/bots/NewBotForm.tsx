import type { BotCreated, BotDraft, CommandOutcome, ModelMenu } from '@highwing/hermes/domain'
import { useState } from 'react'
import { BotForm } from './BotForm'
import { EMPTY_DRAFT, type Submitted } from './bot-form'
import { DEFAULT_LOOK, pictureOf, type Look } from './look'
import { LookPicker, type LookCalls } from './LookPicker'

interface NewBotFormProps {
  readonly problemOf: (name: string) => string | null
  readonly models: ModelMenu | 'loading'
  readonly looks: LookCalls
  readonly onCreate: (draft: BotDraft, picture: string) => Promise<CommandOutcome<BotCreated>>
  readonly onClose: () => void
}

const UNDRAWN: Submitted = { ok: false, refusal: { kind: 'rejected', message: "Highwing couldn't draw that picture. Pick another one." } }

export function NewBotForm({ problemOf, models, looks, onCreate, onClose }: NewBotFormProps) {
  const [look, setLook] = useState<Look>(DEFAULT_LOOK)
  const create = async (draft: BotDraft): Promise<Submitted> => {
    const picture = await pictureOf(look, draft.name).catch(() => null)
    return picture === null ? UNDRAWN : onCreate(draft, picture)
  }
  return (
    <BotForm title="New bot" submitLabel="Create" initial={EMPTY_DRAFT} problemOf={problemOf} models={models} onSubmit={create} onClose={onClose} focusName>
      {draft => <LookPicker look={look} name={draft.name} calls={looks} onLook={setLook} />}
    </BotForm>
  )
}

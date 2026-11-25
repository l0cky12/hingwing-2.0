import { GROUP_NAME_MAX, GROUP_SIZE, groupIdFor, type Bot, type BotId, type GroupDraft, type Refusal } from '@highwing/hermes/domain'
import { namesInWords } from './group-rows'

export type GroupSend = { readonly at: 'editing' } | { readonly at: 'sending' } | { readonly at: 'refused'; readonly refusal: Refusal }

export interface GroupFormState {
  /** Minted when the dialog opens. With `tries` it names the group this dialog makes. */
  readonly dialog: string
  /** Creates Hermes refused. A dropped connection is not one, so the next press sends the same id again. */
  readonly tries: number
  readonly name: string
  /** In the roster's order, which is the order the bots answer in. */
  readonly picked: readonly BotId[]
  readonly query: string
  readonly send: GroupSend
}

export type GroupFormEvent =
  | { readonly on: 'named'; readonly name: string }
  | { readonly on: 'searched'; readonly query: string }
  /** `order`: the offered bots' ids in roster order, so `picked` keeps that order whatever order they are ticked in. */
  | { readonly on: 'toggled'; readonly bot: BotId; readonly order: readonly BotId[] }
  | { readonly on: 'sent' }
  | { readonly on: 'refused'; readonly refusal: Refusal }

const EDITING: GroupSend = { at: 'editing' }

export const startGroupForm = (dialog: string): GroupFormState => ({ dialog, tries: 0, name: '', picked: [], query: '', send: EDITING })

/** Every change of the dialog. A change to the name or the bots clears a refusal's words. */
export function nextGroupForm(state: GroupFormState, event: GroupFormEvent): GroupFormState {
  switch (event.on) {
    case 'named':
      return { ...state, name: event.name, send: EDITING }
    case 'searched':
      return { ...state, query: event.query }
    case 'toggled': {
      const ticked = !state.picked.includes(event.bot)
      if (ticked && state.picked.length >= GROUP_SIZE.max) return state
      return { ...state, picked: event.order.filter(id => (id === event.bot ? ticked : state.picked.includes(id))), send: EDITING }
    }
    case 'sent':
      return { ...state, send: { at: 'sending' } }
    case 'refused':
      return { ...state, tries: state.tries + (event.refusal.kind === 'offline' ? 0 : 1), send: { at: 'refused', refusal: event.refusal } }
  }
}

/** What the dialog draws under its two fields. */
export interface GroupFormView {
  /** The offered bots that match the search. `locked`: not picked while the most a group holds are, so it can't be ticked. */
  readonly rows: readonly { readonly bot: Bot; readonly picked: boolean; readonly locked: boolean }[]
  /** "3 picked: Ada, Sam and Juno", naming the searched-out ones too, or "Pick at least 2 bots" while fewer are picked. */
  readonly tally: string
  /** Hermes's words about the bots, shown under the list. */
  readonly membersWords: string | null
  /** Any other refusal, shown above the buttons. */
  readonly otherWords: string | null
  /** What a press of Create group chat sends, or null while the name is blank or too few bots are picked. */
  readonly draft: GroupDraft | null
}

export function groupFormOf(state: GroupFormState, offered: readonly Bot[]): GroupFormView {
  const picked = offered.filter(bot => state.picked.includes(bot.id))
  const full = picked.length >= GROUP_SIZE.max
  const sought = state.query.trim().toLowerCase()
  const name = state.name.trim()
  const refusal = state.send.at === 'refused' ? state.send.refusal : null
  return {
    rows: offered.filter(bot => bot.name.toLowerCase().includes(sought)).map(bot => {
      const on = picked.includes(bot)
      return { bot, picked: on, locked: full && !on }
    }),
    tally: picked.length < GROUP_SIZE.min ? `Pick at least ${GROUP_SIZE.min} bots` : `${picked.length} picked: ${namesInWords(picked.map(bot => bot.name))}`,
    membersWords: refusal?.field === 'members' ? refusal.message : null,
    otherWords: refusal !== null && refusal.field !== 'members' ? refusal.message : null,
    draft: name === '' || name.length > GROUP_NAME_MAX || picked.length < GROUP_SIZE.min
      ? null
      : { group: groupIdFor(state.dialog, state.tries), name, bots: picked.map(bot => bot.id) }
  }
}

import { GROUP_NAME_MAX, GROUP_SIZE, groupIdFor, type Bot, type BotId, type GroupDraft, type GroupId, type Refusal } from '@highwing/hermes/domain'
import { namesInWords } from './group-rows'

export type GroupSend = { readonly at: 'editing' } | { readonly at: 'sending' } | { readonly at: 'refused'; readonly refusal: Refusal }

export interface GroupFormState {
  readonly seed: string
  readonly refusals: number
  readonly name: string
  readonly picked: readonly BotId[]
  readonly query: string
  readonly send: GroupSend
}

export type GroupFormEvent =
  | { readonly on: 'named'; readonly name: string }
  | { readonly on: 'searched'; readonly query: string }
  | { readonly on: 'toggled'; readonly bot: BotId }
  | { readonly on: 'sent' }
  | { readonly on: 'refused'; readonly refusal: Refusal }

const EDITING: GroupSend = { at: 'editing' }

export const startGroupForm = (seed: string): GroupFormState => ({ seed, refusals: 0, name: '', picked: [], query: '', send: EDITING })

export function nextGroupForm(state: GroupFormState, event: GroupFormEvent): GroupFormState {
  if (state.send.at === 'sending' && (event.on === 'named' || event.on === 'toggled')) return state
  switch (event.on) {
    case 'named':
      return { ...state, name: event.name, send: EDITING }
    case 'searched':
      return { ...state, query: event.query }
    case 'toggled': {
      const ticked = !state.picked.includes(event.bot)
      if (ticked && state.picked.length >= GROUP_SIZE.max) return state
      return { ...state, picked: ticked ? [...state.picked, event.bot] : state.picked.filter(id => id !== event.bot), send: EDITING }
    }
    case 'sent':
      return { ...state, send: { at: 'sending' } }
    case 'refused':
      return { ...state, refusals: state.refusals + (event.refusal.kind === 'offline' ? 0 : 1), send: { at: 'refused', refusal: event.refusal } }
  }
}

export interface GroupFormView {
  readonly rows: readonly { readonly bot: Bot; readonly picked: boolean; readonly locked: boolean }[]
  readonly tally: string
  readonly membersWords: string | null
  readonly otherWords: string | null
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
      : { group: groupIdFor(state.seed, state.refusals), name, bots: picked.map(bot => bot.id) }
  }
}

/**
 * Whether Hermes lists a group under an id this dialog sent. A create whose answer was lost may still have made it,
 * and a later try under the next id would make a second one.
 */
export const madeBy = (state: GroupFormState, listed: readonly GroupId[]): boolean =>
  Array.from({ length: state.refusals + 1 }, (_, refusals) => groupIdFor(state.seed, refusals)).some(id => listed.includes(id))

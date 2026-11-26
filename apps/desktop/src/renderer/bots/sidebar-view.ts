import type { Bot, BotId } from '@highwing/hermes/domain'
import { UNASSIGNED, type ListView } from './roster-view'

export type BotPlace = 'card' | 'pinned' | 'section' | 'hidden'

export const placeOf = (bot: Bot, isDefault: boolean): BotPlace =>
  bot.hidden ? 'hidden' : isDefault ? 'card' : bot.pinned ? 'pinned' : 'section'

export interface RowGroup {
  readonly key: string
  readonly heading: string
  readonly place: 'pinned' | 'section'
  readonly bots: readonly Bot[]
}

export interface HiddenGroup {
  readonly bots: readonly Bot[]
  readonly open: boolean
  readonly holdsOpenBot: boolean
}

export type SidebarView =
  | Exclude<ListView, { show: 'roster' }>
  | {
      readonly show: 'groups'
      readonly card: Bot | null
      readonly groups: readonly RowGroup[]
      readonly hidden: HiddenGroup | null
    }

export function sidebarOf(list: ListView, hiddenOpen: boolean, selected: BotId | null): SidebarView {
  if (list.show !== 'roster') return list
  const listed = list.sections.flatMap(section => section.bots)
  const pinned = listed.filter(bot => placeOf(bot, false) === 'pinned')
  const sections = list.sections
    .map((section): RowGroup => ({
      key: section.name === null ? 'unassigned' : `section:${section.name}`,
      heading: section.name ?? UNASSIGNED,
      place: 'section',
      bots: section.bots.filter(bot => placeOf(bot, false) === 'section')
    }))
    .filter(group => group.bots.length > 0)
  const hidden = [...(list.featured === null ? [] : [list.featured]), ...listed].filter(bot => bot.hidden)
  return {
    show: 'groups',
    card: list.featured !== null && !list.featured.hidden ? list.featured : null,
    groups: [...(pinned.length > 0 ? [{ key: 'pinned', heading: 'Pinned', place: 'pinned' as const, bots: pinned }] : []), ...sections],
    hidden: hidden.length === 0 ? null : { bots: hidden, open: hiddenOpen, holdsOpenBot: hidden.some(bot => bot.id === selected) }
  }
}

export interface Row {
  readonly bot: Bot
  readonly place: BotPlace
}

export function rowsIn(view: SidebarView): readonly Row[] {
  if (view.show !== 'groups') return []
  return [
    ...(view.card === null ? [] : [{ bot: view.card, place: 'card' as const }]),
    ...view.groups.flatMap(group => group.bots.map(bot => ({ bot, place: group.place }))),
    ...(view.hidden?.open === true ? view.hidden.bots.map(bot => ({ bot, place: 'hidden' as const })) : [])
  ]
}

export const NO_MESSAGES = 'No messages yet'

export type BotLine = { readonly kind: 'draft' | 'last'; readonly text: string }

/** The open chat's bot never shows its draft, which is in the composer already. */
export function lineOf(bot: Bot, drafts: ReadonlyMap<BotId, string>, selected: BotId | null): BotLine {
  const draft = bot.id === selected ? undefined : drafts.get(bot.id)
  if (draft === undefined) return { kind: 'last', text: bot.preview ?? NO_MESSAGES }
  return { kind: 'draft', text: draft.split('\n').map(line => line.trim()).find(line => line !== '') ?? '' }
}

export function drawnAbove(view: SidebarView, bot: BotId): string | null {
  if (view.show !== 'groups') return null
  const drawn: (readonly [string, string | boolean])[] = []
  if (view.card !== null) drawn.push(['card', view.card.id])
  for (const group of view.groups) drawn.push(['heading', group.key], ...group.bots.map(held => ['row', held.id] as const))
  if (view.hidden !== null) drawn.push(['hidden', view.hidden.open], ...(view.hidden.open ? view.hidden.bots.map(held => ['row', held.id] as const) : []))
  const at = drawn.findIndex(([kind, id]) => (kind === 'card' || kind === 'row') && id === bot)
  return at === -1 ? null : JSON.stringify(drawn.slice(0, at))
}

/** What is drawn above the Group chats section: the default bot's card and Pinned. */
export function drawnAboveGroups(view: SidebarView): string | null {
  if (view.show !== 'groups') return null
  return JSON.stringify([view.card?.id ?? null, ...view.groups.filter(group => group.place === 'pinned').flatMap(group => group.bots.map(bot => bot.id))])
}

export type HiddenTrigger = 'search' | 'all-hidden' | `open:${string}`

export function hiddenTriggers(list: ListView, searching: boolean, open: Bot | null): readonly HiddenTrigger[] {
  const bots = list.show === 'roster' ? [...(list.featured === null ? [] : [list.featured]), ...list.sections.flatMap(section => section.bots)] : []
  return [
    ...(searching && bots.some(bot => bot.hidden) ? ['search' as const] : []),
    ...(!searching && bots.length > 0 && bots.every(bot => bot.hidden) ? ['all-hidden' as const] : []),
    ...(open?.hidden === true ? [`open:${open.id}` as const] : [])
  ]
}

export interface HiddenState {
  readonly open: boolean
  readonly seen: readonly HiddenTrigger[]
}

export const HIDDEN_CLOSED: HiddenState = { open: false, seen: [] }

export type HiddenEvent = { readonly on: 'click' } | { readonly on: 'render'; readonly triggers: readonly HiddenTrigger[] }

export function nextHidden(state: HiddenState, event: HiddenEvent): HiddenState {
  if (event.on === 'click') return { ...state, open: !state.open }
  const { triggers } = event
  if (triggers.length === state.seen.length && triggers.every(trigger => state.seen.includes(trigger))) return state
  return { open: state.open || triggers.some(trigger => !state.seen.includes(trigger)), seen: triggers }
}

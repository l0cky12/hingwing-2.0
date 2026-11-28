import type { BotModelSettings, CommandOutcome, ModelOption } from '@highwing/hermes/domain'

export type ModelRow = 'main' | 'backup'

export type ModelsRead =
  | { readonly at: 'reading' }
  | { readonly at: 'read'; readonly settings: BotModelSettings }
  | { readonly at: 'refused'; readonly words: string; readonly unsupported: boolean }

export interface ModelsState {
  readonly read: ModelsRead
  readonly saving: ModelRow | null
  readonly confirm: { readonly model: ModelOption; readonly message: string } | null
  readonly problem: { readonly row: ModelRow; readonly words: string } | null
}

export type ModelsEvent =
  | { readonly on: 'otherBot' }
  | { readonly on: 'read'; readonly outcome: CommandOutcome<BotModelSettings> }
  | { readonly on: 'saving'; readonly row: ModelRow }
  | { readonly on: 'saved' }
  | { readonly on: 'confirm'; readonly model: ModelOption; readonly message: string }
  | { readonly on: 'keep' }
  | { readonly on: 'failed'; readonly row: ModelRow; readonly words: string }

export const FIRST_MODELS: ModelsState = { read: { at: 'reading' }, saving: null, confirm: null, problem: null }

export function nextModels(state: ModelsState, event: ModelsEvent): ModelsState {
  switch (event.on) {
    case 'otherBot': return FIRST_MODELS
    case 'read': {
      const { outcome } = event
      return { ...state, read: outcome.ok ? { at: 'read', settings: outcome.value } : { at: 'refused', words: outcome.refusal.message, unsupported: outcome.refusal.kind === 'unsupported' } }
    }
    case 'saving': return { ...state, saving: event.row, confirm: null, problem: null }
    case 'saved': return { ...state, saving: null }
    case 'confirm': return { ...state, saving: null, confirm: { model: event.model, message: event.message } }
    case 'keep': return { ...state, confirm: null }
    case 'failed': return { ...state, saving: null, problem: { row: event.row, words: event.words } }
  }
}

export const NOT_CONNECTED = 'Connect to Hermes to choose models.'

export type ModelsSection =
  | { readonly show: 'note'; readonly words: string }
  | { readonly show: 'reading' }
  | { readonly show: 'failed'; readonly words: string }
  | { readonly show: 'models'; readonly settings: BotModelSettings }

export function modelsSectionOf(bot: string, read: ModelsRead): ModelsSection {
  if (read.at === 'reading') return { show: 'reading' }
  if (read.at === 'refused') return read.unsupported ? { show: 'note', words: read.words } : { show: 'failed', words: read.words }
  return read.settings.options.length === 0 ? { show: 'note', words: `This Hermes lists no models for ${bot}.` } : { show: 'models', settings: read.settings }
}

export const moreBackups = (more: number): string =>
  `Hermes also has ${more} more ${more === 1 ? 'backup' : 'backups'} set outside Highwing. No backup removes them all.`

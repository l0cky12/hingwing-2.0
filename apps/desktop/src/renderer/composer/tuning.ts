import { EFFORTS, machineOf, type Effort, type Target, type Tuning } from '@highwing/hermes/domain'

export type ThinkingTune =
  | { readonly set: 'effort'; readonly to: Effort | 'default' }
  | { readonly set: 'fast'; readonly on: boolean }
  | { readonly set: 'reasoning'; readonly on: boolean }

export const LEVELS = ['default', ...EFFORTS] as const

export const EFFORT_WORDS: { readonly [L in typeof LEVELS[number]]: string } = {
  default: 'Default', none: 'Off', minimal: 'Minimal', low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max', ultra: 'Ultra'
}

export const thinkingShown = (tuning: Tuning): boolean => tuning.effort !== null || tuning.fast !== null || tuning.reasoning !== null

export const thinkingLabel = (tuning: Tuning): string => (tuning.effort === null ? 'Thinking' : `Effort: ${EFFORT_WORDS[tuning.effort]}`)

export const folderFieldLabel = (target: Target | null): string => `Folder on ${target === null ? 'the Hermes machine' : machineOf(target)}`

export type FontRole = 'interface' | 'prompt' | 'code' | 'terminal'
export interface FontPick { readonly family: string | null; readonly size: number }
export type WrapRole = 'code' | 'terminal'
export type ChatWidth = 'narrow' | 'comfortable' | 'wide' | 'full'

export interface Appearance {
  readonly fonts: { readonly [R in FontRole]: FontPick }
  readonly wrap: { readonly [W in WrapRole]: boolean }
  readonly chatWidth: ChatWidth
  readonly contrast: number
  readonly motionMs: number
  readonly math: boolean
}

interface FontRoleSpec {
  readonly label: string
  readonly desc: string
  readonly face: string
  readonly stack: string
  readonly size: number
  readonly min: number
  readonly max: number
  readonly wrap: WrapRole | null
  readonly sample: string
  readonly vars: { readonly family: string; readonly scale: string }
}

const SANS = 'Schibsted, "Liberation Sans", sans-serif'
const MONO = '"JetBrains Mono", "DejaVu Sans Mono", monospace'

export const FONT_ROLES: { readonly [R in FontRole]: FontRoleSpec } = {
  interface: {
    label: 'Interface font', desc: 'Menus, settings and replies.', face: 'Schibsted Grotesk', stack: SANS, size: 14, min: 11, max: 20, wrap: null,
    sample: 'Highwing keeps your bots, their chats and your settings in one window.', vars: { family: '--sans', scale: '--ui-scale' }
  },
  prompt: {
    label: 'Prompt font', desc: 'What you type, and the messages you send.', face: 'Schibsted Grotesk', stack: SANS, size: 15, min: 12, max: 22, wrap: null,
    sample: 'Tidy the README, then open a pull request with the changes.', vars: { family: '--prompt-font', scale: '--prompt-scale' }
  },
  code: {
    label: 'Code font', desc: 'Code blocks, changes to files and file paths.', face: 'JetBrains Mono', stack: MONO, size: 13, min: 10, max: 20, wrap: 'code',
    sample: 'function greet(name) {\n-  return "Hi " + name\n+  return `Hello, ${name}! Welcome back, it has been a while since we last saw you.`\n}',
    vars: { family: '--mono', scale: '--code-scale' }
  },
  terminal: {
    label: 'Terminal font', desc: 'Commands run in a chat, and what they print.', face: 'JetBrains Mono', stack: MONO, size: 12, min: 10, max: 20, wrap: 'terminal',
    sample: '$ pnpm test\n✓ apps/desktop/test/appearance.test.ts (24 tests) 41ms\n✓ apps/desktop/test/preferences.test.ts (96 tests) 212ms\nDone in 3.2s',
    vars: { family: '--terminal-font', scale: '--terminal-scale' }
  }
}
export const ROLE_ORDER: readonly FontRole[] = ['interface', 'prompt', 'code', 'terminal']

export const CHAT_WIDTHS: { readonly [W in ChatWidth]: { readonly label: string; readonly column: string; readonly measure: string; readonly request: string } } = {
  narrow: { label: 'Narrow', column: '640px', measure: '56ch', request: '52ch' },
  comfortable: { label: 'Comfortable', column: '760px', measure: '66ch', request: '62ch' },
  wide: { label: 'Wide', column: '960px', measure: '84ch', request: '80ch' },
  full: { label: 'Full width', column: '100%', measure: '100%', request: '100%' }
}
export const WIDTH_ORDER: readonly ChatWidth[] = ['narrow', 'comfortable', 'wide', 'full']

export const CONTRAST = { min: 50, max: 150, default: 100 } as const
export const MOTION = { min: 0, max: 400, default: 150 } as const
const DURATIONS: { readonly [property: string]: number } = { '--duration-fast': 150, '--duration-blink': 1000, '--duration-pulse': 1600, '--duration-dots': 1200 }

const defaultPick = (role: FontRole): FontPick => ({ family: null, size: FONT_ROLES[role].size })

export const DEFAULT_APPEARANCE: Appearance = {
  fonts: { interface: defaultPick('interface'), prompt: defaultPick('prompt'), code: defaultPick('code'), terminal: defaultPick('terminal') },
  wrap: { code: false, terminal: true },
  chatWidth: 'comfortable',
  contrast: CONTRAST.default,
  motionMs: MOTION.default,
  math: true
}

export const isFontFamily = (raw: unknown): raw is string =>
  typeof raw === 'string' && raw.length <= 200 && raw.trim() === raw && raw !== '' && !/[\p{Cc}"'\\;{}]/u.test(raw)

type Obj = { readonly [key: string]: unknown }
const isObject = (raw: unknown): raw is Obj => raw !== null && typeof raw === 'object' && !Array.isArray(raw)
const hasExactly = (raw: Obj, keys: readonly string[]) => Object.keys(raw).length === keys.length && keys.every(key => Object.hasOwn(raw, key))
const within = (raw: unknown, min: number, max: number): raw is number => Number.isInteger(raw) && (raw as number) >= min && (raw as number) <= max

const isPick = (role: FontRole, raw: unknown): raw is FontPick =>
  isObject(raw) && hasExactly(raw, ['family', 'size']) && (raw.family === null || isFontFamily(raw.family)) && within(raw.size, FONT_ROLES[role].min, FONT_ROLES[role].max)

export const isAppearance = (raw: unknown): raw is Appearance =>
  isObject(raw) && hasExactly(raw, ['fonts', 'wrap', 'chatWidth', 'contrast', 'motionMs', 'math'])
  && isObject(raw.fonts) && hasExactly(raw.fonts, ROLE_ORDER) && ROLE_ORDER.every(role => isPick(role, (raw.fonts as Obj)[role]))
  && isObject(raw.wrap) && hasExactly(raw.wrap, ['code', 'terminal']) && typeof raw.wrap.code === 'boolean' && typeof raw.wrap.terminal === 'boolean'
  && typeof raw.chatWidth === 'string' && Object.hasOwn(CHAT_WIDTHS, raw.chatWidth)
  && within(raw.contrast, CONTRAST.min, CONTRAST.max) && within(raw.motionMs, MOTION.min, MOTION.max) && typeof raw.math === 'boolean'

export const familyOf = (role: FontRole, family: string | null) => (family === null ? FONT_ROLES[role].stack : `"${family}", ${FONT_ROLES[role].stack}`)

export const isDefaultRole = (appearance: Appearance, role: FontRole): boolean => {
  const { family, size } = appearance.fonts[role]
  const wrap = FONT_ROLES[role].wrap
  return family === null && size === FONT_ROLES[role].size && (wrap === null || appearance.wrap[wrap] === DEFAULT_APPEARANCE.wrap[wrap])
}

export function fontChoices(installed: readonly string[], saved: string | null): readonly string[] {
  const names = new Set(installed.filter(isFontFamily))
  if (saved !== null) names.add(saved)
  return [...names].sort((a, b) => a.localeCompare(b))
}

const WRAPS: { readonly [W in WrapRole]: (on: boolean) => { readonly [property: string]: string } } = {
  code: on => ({ '--code-wrap': on ? 'pre-wrap' : 'pre', '--code-break': on ? 'anywhere' : 'normal' }),
  terminal: on => ({ '--terminal-wrap': on ? 'pre-wrap' : 'pre' })
}

const contrasted = (lift: number) => (base: string) =>
  lift === 0 ? `var(${base})` : `color-mix(in srgb, var(${base}), var(${lift < 0 ? '--paper' : '--ink'}) ${Math.abs(lift)}%)`

export function appearanceStyle(appearance: Appearance): Record<string, string> {
  const { column, measure, request } = CHAT_WIDTHS[appearance.chatWidth]
  const mixed = contrasted(appearance.contrast - CONTRAST.default)
  return {
    ...Object.fromEntries(ROLE_ORDER.flatMap(role => {
      const { vars, size } = FONT_ROLES[role]
      const pick = appearance.fonts[role]
      return [[vars.family, familyOf(role, pick.family)], [vars.scale, String(pick.size / size)]]
    })),
    ...WRAPS.code(appearance.wrap.code),
    ...WRAPS.terminal(appearance.wrap.terminal),
    '--chat-width': column,
    '--measure': measure,
    '--request-measure': request,
    '--graphite': mixed('--graphite-base'),
    '--rule': mixed('--rule-base'),
    ...Object.fromEntries(Object.entries(DURATIONS).map(([property, ms]) => [property, `${Math.round(ms * appearance.motionMs / MOTION.default)}ms`]))
  }
}

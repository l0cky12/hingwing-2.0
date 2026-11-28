import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

interface FakeWindow { background: string; readonly closed: (() => void)[] }
const electron = vi.hoisted(() => ({ dark: false, updated: new Set<() => void>(), windows: [] as FakeWindow[] }))

vi.mock('electron', () => ({
  nativeTheme: {
    get shouldUseDarkColors() { return electron.dark },
    on: (_event: 'updated', listener: () => void) => electron.updated.add(listener),
    off: (_event: 'updated', listener: () => void) => electron.updated.delete(listener)
  },
  BrowserWindow: class implements FakeWindow {
    background: string
    readonly closed: (() => void)[] = []
    readonly webContents = { setWindowOpenHandler: () => {}, on: () => {} }
    constructor({ backgroundColor }: { readonly backgroundColor: string }) {
      this.background = backgroundColor
      electron.windows.push(this)
    }
    setBackgroundColor(color: string) { this.background = color }
    setMenuBarVisibility() {}
    setContentSize() {}
    once(event: string, listener: () => void) { if (event === 'closed') this.closed.push(listener) }
    loadFile = async () => {}
    loadURL = async () => {}
  }
}))

const { openWindow } = await import('../src/main/windows')

const CSS = readFileSync(new URL('../src/renderer/styles/app.css', import.meta.url), 'utf8')

interface Rule { readonly media: readonly string[]; readonly selector: string; readonly declarations: ReadonlyMap<string, string> }

const declarationsOf = (text: string) => new Map(text.split(';').flatMap(line => {
  const at = line.indexOf(':')
  return at < 0 ? [] : [[line.slice(0, at).trim(), line.slice(at + 1).trim()] as const]
}))

function rulesNestedOnlyInAtRules(css: string): Rule[] {
  const rules: Rule[] = []
  const open: string[] = []
  let text = ''
  for (const char of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (char === '{') {
      open.push(text.trim())
      text = ''
    } else if (char === '}') {
      const selector = open.pop()!
      if (text.trim() !== '') rules.push({ media: open.filter(prelude => prelude.startsWith('@media')), selector, declarations: declarationsOf(text) })
      text = ''
    } else {
      text += char
    }
  }
  return rules
}

interface Scheme { readonly dark: boolean; readonly more: boolean }
const FEATURES: Readonly<Record<string, (scheme: Scheme) => boolean>> = {
  'prefers-color-scheme: dark': ({ dark }) => dark,
  'prefers-color-scheme: light': ({ dark }) => !dark,
  'prefers-contrast: more': ({ more }) => more
}
const applies = (media: readonly string[], scheme: Scheme) =>
  media.every(prelude => Array.from(prelude.matchAll(/\(([^)]+)\)/g), ([, feature]) => FEATURES[feature!.replace(/\s+/g, ' ')]?.(scheme) ?? false).every(Boolean))

const ROOTS = rulesNestedOnlyInAtRules(CSS).filter(rule => rule.selector === ':root')
const paletteOf = (scheme: Scheme): ReadonlyMap<string, string> =>
  new Map(ROOTS.filter(rule => applies(rule.media, scheme)).flatMap(rule => [...rule.declarations]))

const colorIn = (palette: ReadonlyMap<string, string>, name: string): string => {
  const value = palette.get(`--${name}`) ?? ''
  const derived = /^var\(--([\w-]+)\)$/.exec(value)
  return derived === null ? value : colorIn(palette, derived[1]!)
}

const isColor = (value: string) => !value.includes('var(') && /^(#[0-9a-f]{3,8}|(rgb|hsl|oklch|oklab|lab|lch)a?\(.*\)|\d+ \d+ \d+)$/i.test(value)

const channels = (hex: string) => {
  const digits = hex.slice(1).length === 3 ? hex.slice(1).replace(/./g, '$&$&') : hex.slice(1)
  return [0, 2, 4].map(at => parseInt(digits.slice(at, at + 2), 16) / 255)
}
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map(c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const contrast = (a: string, b: string) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

const TEXT = ['ink', 'graphite', 'signal', 'caution', 'brick', 'moss']
const SURFACES = ['rail', 'paper', 'sheet', 'surface-user', 'code-bg', 'signal-soft', 'caution-soft', 'add', 'del']
const AVATARS = ['avatar-slate', 'avatar-plum', 'avatar-olive', 'avatar-mauve', 'avatar-umber']
const PAIRS = [...TEXT.flatMap(text => SURFACES.map(surface => [text, surface, 4.5] as const)), ...AVATARS.map(avatar => ['sheet', avatar, 4.5] as const)]
const EDGES = ['rail', 'paper', 'sheet'].map(surface => ['edge', surface, 3] as const)

const SCHEMES: readonly [string, Scheme][] = [
  ['light', { dark: false, more: false }],
  ['dark', { dark: true, more: false }],
  ['light with more contrast', { dark: false, more: true }],
  ['dark with more contrast', { dark: true, more: true }]
]

describe('the palettes in app.css', () => {
  it('redefines every color of the light palette for a dark desktop, and tells Chromium which scheme each one is', () => {
    const light = paletteOf({ dark: false, more: false })
    const darkOnly = new Map(ROOTS.filter(rule => rule.media.join() === '@media (prefers-color-scheme: dark)').flatMap(rule => [...rule.declarations]))
    const colors = [...light].filter(([name, value]) => name.startsWith('--') && isColor(value)).map(([name]) => name)
    expect(colors.length).toBeGreaterThan(20)
    expect(colors.filter(name => !darkOnly.has(name)), 'colors the dark palette leaves light').toEqual([])
    expect(light.get('color-scheme')).toBe('light')
    expect(darkOnly.get('color-scheme')).toBe('dark')
  })

  it.each(SCHEMES)('keeps text at 4.5:1 and edges at 3:1 in %s', (_name, scheme) => {
    const palette = paletteOf(scheme)
    const colorOf = (name: string) => colorIn(palette, name)
    const rules = scheme.more ? ['rail', 'paper', 'sheet'].map(surface => ['rule', surface, 3] as const) : []
    const short = [...PAIRS, ...EDGES, ...rules].flatMap(([fore, back, least]) => {
      const ratio = contrast(colorOf(fore), colorOf(back))
      return ratio >= least ? [] : [`${fore} on ${back}: ${ratio.toFixed(2)}, under ${least}`]
    })
    expect(short).toEqual([])
  })
})

const LITERALS: readonly (readonly [string, (property: string, value: string) => boolean])[] = [
  ['colour', (_property, value) => /#[0-9a-f]{3,8}\b|\b(rgb|hsl)a?\(|\b(white|black)\b/i.test(value)],
  ['shade', (_property, value) => value.includes('var(--shade)')],
  ['radius', (property, value) => property.endsWith('radius') && /\d(px|%)/.test(value)],
  ['type size', (property, value) => (property === 'font' || property === 'font-size') && /(^|\s)[\d.]+px/.test(value)],
  ['duration', (property, value) => /^(transition|animation)/.test(property) && /(^|[\s,])(?!0s\b)[\d.]+m?s\b/.test(value)]
]

describe('the component rules in app.css', () => {
  it('take every colour, radius, type size, shadow and duration from a token on :root', () => {
    const components = rulesNestedOnlyInAtRules(CSS).filter(rule => rule.selector !== ':root' && rule.selector !== '@font-face')
    expect(components.length).toBeGreaterThan(500)
    const literal = components.flatMap(({ selector, declarations }) => [...declarations].flatMap(([property, value]) =>
      LITERALS.filter(([, matches]) => matches(property, value)).map(([kind]) => `${kind} in ${selector} { ${property}: ${value} }`)))
    expect(literal).toEqual([])
  })
})

describe('the window behind the page', () => {
  const flip = (dark: boolean) => {
    electron.dark = dark
    for (const listener of [...electron.updated]) listener()
  }
  const paperOf = (dark: boolean) => paletteOf({ dark, more: false }).get('--paper')

  it("is the page's paper in the palette the desktop asks for, and follows each switch until the window closes", () => {
    electron.dark = true
    openWindow({ browse: async () => {} }, { attach: () => {} }, () => {})
    const window = electron.windows.at(-1)!
    expect(window.background).toBe(paperOf(true))
    flip(false)
    expect(window.background).toBe(paperOf(false))
    flip(true)
    expect(window.background).toBe(paperOf(true))
    window.closed.forEach(listener => listener())
    expect(electron.updated.size).toBe(0)
  })
})

describe('the accent in app.css', () => {
  const rules = rulesNestedOnlyInAtRules(CSS)
  const accentRules = rules.filter(rule => rule.media.length === 0 && /^\[data-accent="\w+"\]$/.test(rule.selector))
  const TONES = ['ink', 'slate', 'plum', 'olive', 'mauve', 'umber']
  const tokenOf = (tone: string) => /^var\(--([\w-]+)\)$/.exec(accentRules.find(rule => rule.selector === `[data-accent="${tone}"]`)?.declarations.get('--accent') ?? '')?.[1] ?? ''
  const fillOf = (tone: string) => /^var\(--([\w-]+)\)$/.exec(rules.find(rule => rule.media.length === 0 && rule.selector === `.tone-${tone}`)?.declarations.get('background') ?? '')?.[1] ?? ''
  const bandShare = Number(/color-mix\(in srgb, var\(--accent, var\(--sheet\)\) ([\d.]+)%, var\(--sheet\)\)/.exec(rules.find(rule => rule.selector === '.top .bar :is(h1, .members, .pencil)')?.declarations.get('background') ?? '')?.[1]) / 100
  const mixed = (accent: string, sheet: string) => {
    const [a, b] = [channels(accent), channels(sheet)]
    return '#' + a.map((c, at) => Math.round((c * bandShare + b[at]! * (1 - bandShare)) * 255).toString(16).padStart(2, '0')).join('')
  }

  it('paints every tone a bot can have, and the header tint is a share the CSS states', () => {
    expect(accentRules.map(rule => rule.selector.slice('[data-accent="'.length, -2))).toEqual(TONES)
    expect(bandShare).toBeGreaterThan(0)
  })

  it.each(SCHEMES)('keeps the send icon readable on every bot tone and the header text on every accent in %s', (_name, scheme) => {
    const palette = paletteOf(scheme)
    const colorOf = (name: string) => colorIn(palette, name)
    const short = TONES.flatMap(tone => {
      const accent = colorOf(tokenOf(tone))
      const band = mixed(accent, colorOf('sheet'))
      return ([['sheet', colorOf(fillOf(tone)), 'send icon'], ['graphite', band, 'header text'], ['ink', band, 'header title']] as const).flatMap(([text, surface, what]) => {
        const ratio = contrast(colorOf(text), surface)
        return ratio >= 4.5 ? [] : [`${tone} ${what}: ${ratio.toFixed(2)}, under 4.5`]
      })
    })
    expect(short).toEqual([])
  })
})

describe("the marks on a bot's face", () => {
  const RULES = rulesNestedOnlyInAtRules(CSS)
  const inMedia = (feature: string) => RULES.filter(rule => rule.media.some(prelude => prelude.includes(feature)))

  it('animate the working dots, and stop every animation under reduced motion', () => {
    const animated = RULES.filter(rule => rule.media.length === 0 && /working-dot/.test(rule.declarations.get('animation') ?? ''))
    expect(animated.map(rule => rule.selector)).toEqual(['.bot-activity[data-activity="working"] > span'])
    const stopped = inMedia('prefers-reduced-motion: reduce').filter(rule => rule.selector.split(',').map(part => part.trim()).includes('*'))
    expect(stopped.map(rule => rule.declarations.get('animation'))).toEqual(['none !important'])
  })

  /** The value the cascade gives `property` on an element only these selectors match, in forced colors. Specificity counts classes and attributes, all these use. */
  const forcedValue = (selectors: readonly string[], property: string) => {
    const specificity = (selector: string) => (selector.match(/[.[]/g) ?? []).length
    const candidates = RULES.flatMap((rule, order) => {
      if (!rule.media.every(prelude => prelude.includes('forced-colors: active')) || !rule.declarations.has(property)) return []
      const matched = rule.selector.split(',').map(part => part.trim()).filter(part => selectors.includes(part))
      return matched.length === 0 ? [] : [{ weight: Math.max(...matched.map(specificity)), order, value: rule.declarations.get(property) }]
    })
    return candidates.sort((a, b) => a.weight - b.weight || a.order - b.order).at(-1)?.value
  }
  const SYSTEM = new Set(['Canvas', 'CanvasText', 'Highlight', 'HighlightText'])
  const markOf = (state: string) => ['.bot-activity', '.bot-activity[data-activity]', `.bot-activity[data-activity="${state}"]`]

  it.each([
    ['working', 'Canvas', ['.bot-activity[data-activity="working"] > span']],
    ['waiting', 'Highlight', null],
    ['unread', 'CanvasText', null]
  ] as const)('draw the %s mark in forced colors in system colors only, inside a CanvasText border', (state, background, dots) => {
    expect(forcedValue(markOf(state), 'forced-color-adjust')).toBe('none')
    expect(forcedValue(markOf(state), 'border')).toBe('1px solid CanvasText')
    expect(forcedValue(markOf(state), 'background')).toBe(background)
    if (dots !== null) expect(forcedValue(dots, 'background')).toBe('CanvasText')
    expect(SYSTEM.has(forcedValue(markOf(state), 'color') ?? '')).toBe(true)
  })
})

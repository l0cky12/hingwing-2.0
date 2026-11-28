import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appearanceStyle, DEFAULT_APPEARANCE, isAppearance, type Appearance, type FontPick, type FontRole } from '../src/appearance'
import { APPEARANCE, readPreference } from '../src/main/preferences'

const withFont = (role: FontRole, pick: FontPick): Appearance => ({ ...DEFAULT_APPEARANCE, fonts: { ...DEFAULT_APPEARANCE.fonts, [role]: pick } })
const stylesheet = readFileSync(join(import.meta.dirname, '../src/renderer/styles/app.css'), 'utf8')
/** The value the stylesheet's first `:root` rule gives a custom property. */
const sheetDefault = (property: string) => new RegExp(`^:root \\{[^}]*?\\n  ${property}: ([^;]+);`, 'ms').exec(stylesheet)?.[1]

describe('an appearance from outside the renderer', () => {
  it('takes the default appearance', () => {
    expect(isAppearance(DEFAULT_APPEARANCE)).toBe(true)
  })

  it.each([
    'Inter', 'Noto Sans CJK JP', 'Fira Code Retina', 'Source Code Pro', 'Bitstream Vera Sans Mono', 'Æther & Co.', 'x'.repeat(200)
  ])('takes the face %s', family => {
    expect(isAppearance(withFont('code', { family, size: 13 }))).toBe(true)
  })

  it.each([
    ['an empty name', ''],
    ['a name of spaces', '   '],
    ['a name with a space at its edge', ' Inter'],
    ['a name over 200 characters', 'x'.repeat(201)],
    ['a double quote', 'Inter", serif; --x: 1'],
    ['a single quote', "Inter'"],
    ['a backslash', 'Inter\\22'],
    ['a semicolon', 'Inter;'],
    ['a brace', 'Inter}'],
    ['a line break', 'Inter\nserif'],
    ['a NUL', 'Inter\u0000'],
    ['a number', 7]
  ])('refuses a face with %s', (_, family) => {
    expect(isAppearance(withFont('interface', { family, size: 14 } as unknown as FontPick))).toBe(false)
  })

  it.each([
    ['interface', 10], ['interface', 21], ['prompt', 11], ['prompt', 23], ['code', 9], ['code', 21], ['terminal', 9], ['terminal', 21], ['code', 13.5], ['code', Number.NaN]
  ] as const)('refuses a %s size of %s', (role, size) => {
    expect(isAppearance(withFont(role, { family: null, size }))).toBe(false)
  })

  it.each([
    ['interface', 11], ['interface', 20], ['prompt', 12], ['prompt', 22], ['code', 10], ['code', 20], ['terminal', 10], ['terminal', 20]
  ] as const)('takes a %s size of %s', (role, size) => {
    expect(isAppearance(withFont(role, { family: null, size }))).toBe(true)
  })

  it.each([
    ['no math switch', (({ math: _, ...rest }) => rest)(DEFAULT_APPEARANCE)],
    ['an extra field', { ...DEFAULT_APPEARANCE, glass: 80 }],
    ['a role Highwing does not have', { ...DEFAULT_APPEARANCE, fonts: { ...DEFAULT_APPEARANCE.fonts, chat: { family: null, size: 14 } } }],
    ['a role missing', { ...DEFAULT_APPEARANCE, fonts: (({ terminal: _, ...rest }) => rest)(DEFAULT_APPEARANCE.fonts) }],
    ['a wrap switch that is no boolean', { ...DEFAULT_APPEARANCE, wrap: { code: 'yes', terminal: true } }],
    ['a chat width Highwing does not have', { ...DEFAULT_APPEARANCE, chatWidth: 'toString' }],
    ['a contrast under 50', { ...DEFAULT_APPEARANCE, contrast: 49 }],
    ['a contrast over 150', { ...DEFAULT_APPEARANCE, contrast: 151 }],
    ['a motion under 0', { ...DEFAULT_APPEARANCE, motionMs: -1 }],
    ['a motion over 400', { ...DEFAULT_APPEARANCE, motionMs: 401 }],
    ['an array', []],
    ['null', null]
  ])('refuses %s', (_, raw) => {
    expect(isAppearance(raw)).toBe(false)
  })
})

describe('the appearance.json preference', () => {
  it('reads an appearance as this build wrote it', () => {
    const picked = withFont('code', { family: 'Fira Code', size: 15 })
    expect(readPreference(APPEARANCE, JSON.stringify({ version: 1, appearance: picked }))).toEqual(picked)
  })

  it.each([
    ['half a file', '{"version": 1, "appearance": {"fonts"'],
    ['a later version', JSON.stringify({ version: 2, appearance: DEFAULT_APPEARANCE })],
    ['a face that would break out of its quotes', JSON.stringify({ version: 1, appearance: withFont('code', { family: 'x"; color: red', size: 13 }) })],
    ['a size out of range', JSON.stringify({ version: 1, appearance: withFont('terminal', { family: null, size: 99 }) })],
    ['a value of another shape', JSON.stringify({ version: 1, appearance: 'wide' })]
  ])('reads %s as the default appearance', (_, text) => {
    expect(readPreference(APPEARANCE, text)).toBe(DEFAULT_APPEARANCE)
  })
})

describe('the custom properties of an appearance', () => {
  it('match what the window drew before Appearance had these settings', () => {
    expect(appearanceStyle(DEFAULT_APPEARANCE)).toMatchObject({
      '--sans': 'Schibsted, "Liberation Sans", sans-serif',
      '--mono': '"JetBrains Mono", "DejaVu Sans Mono", monospace',
      '--ui-scale': '1',
      '--code-scale': '1',
      '--code-wrap': 'pre',
      '--terminal-wrap': 'pre-wrap',
      '--chat-width': '760px',
      '--measure': '66ch',
      '--request-measure': '62ch',
      '--graphite': 'var(--graphite-base)',
      '--duration-fast': '150ms'
    })
  })

  it('give each property the value the stylesheet starts it at', () => {
    const style = appearanceStyle(DEFAULT_APPEARANCE)
    const sheet = Object.fromEntries(Object.keys(style).map(property => [property, sheetDefault(property)]))
    expect(sheet).toEqual(style)
  })

  it('quote a picked face and keep the default face behind it', () => {
    expect(appearanceStyle(withFont('code', { family: 'Fira Code', size: 13 }))['--mono']).toBe('"Fira Code", "JetBrains Mono", "DejaVu Sans Mono", monospace')
    expect(appearanceStyle(withFont('prompt', { family: 'Inter', size: 15 }))['--prompt-font']).toBe('"Inter", Schibsted, "Liberation Sans", sans-serif')
  })

  it('scale a role by its size over the default size', () => {
    expect(appearanceStyle(withFont('prompt', { family: null, size: 18 }))['--prompt-scale']).toBe('1.2')
    expect(appearanceStyle(withFont('terminal', { family: null, size: 18 }))['--terminal-scale']).toBe('1.5')
  })

  it('let long code lines wrap when asked', () => {
    expect(appearanceStyle({ ...DEFAULT_APPEARANCE, wrap: { code: true, terminal: false } })).toMatchObject({ '--code-wrap': 'pre-wrap', '--code-break': 'anywhere', '--terminal-wrap': 'pre' })
  })

  it('widen the column and the lines with a wider chat', () => {
    expect(appearanceStyle({ ...DEFAULT_APPEARANCE, chatWidth: 'wide' })).toMatchObject({ '--chat-width': '960px', '--measure': '84ch', '--request-measure': '80ch' })
    expect(appearanceStyle({ ...DEFAULT_APPEARANCE, chatWidth: 'full' })).toMatchObject({ '--chat-width': '100%', '--measure': '100%' })
  })

  it('mix the quiet colors toward the text above 100 and toward the page below it', () => {
    expect(appearanceStyle({ ...DEFAULT_APPEARANCE, contrast: 130 })).toMatchObject({ '--graphite': 'color-mix(in srgb, var(--graphite-base), var(--ink) 30%)', '--rule': 'color-mix(in srgb, var(--rule-base), var(--ink) 30%)' })
    expect(appearanceStyle({ ...DEFAULT_APPEARANCE, contrast: 60 })).toMatchObject({ '--graphite': 'color-mix(in srgb, var(--graphite-base), var(--paper) 40%)' })
  })

  it('stop every animation at 0 and keep their proportions otherwise', () => {
    expect(appearanceStyle({ ...DEFAULT_APPEARANCE, motionMs: 0 })).toMatchObject({ '--duration-fast': '0ms', '--duration-blink': '0ms', '--duration-pulse': '0ms', '--duration-dots': '0ms' })
    expect(appearanceStyle({ ...DEFAULT_APPEARANCE, motionMs: 300 })).toMatchObject({ '--duration-fast': '300ms', '--duration-pulse': '3200ms' })
  })
})

import type { Mermaid, MermaidConfig } from 'mermaid'

export function diagramFor(lang: string | null): 'mermaid' | null {
  return lang?.toLowerCase() === 'mermaid' ? 'mermaid' : null
}

/** Mermaid's own `maxTextSize`. Past it Mermaid draws a "Maximum text size" box instead of failing. */
const MAX_DIAGRAM_CHARS = 50_000
const CACHE_LIMIT = 50

/** Every diagram kind whose config takes `useMaxWidth`. Mermaid has no global switch for it. */
const DIAGRAM_CONFIGS = [
  'flowchart', 'swimlane', 'agentflow', 'sequence', 'gantt', 'journey', 'timeline', 'class', 'state', 'er', 'pie',
  'quadrantChart', 'xyChart', 'requirement', 'architecture', 'mindmap', 'ishikawa', 'kanban', 'gitGraph', 'c4',
  'sankey', 'packet', 'block', 'eventmodeling', 'treeView', 'radar', 'usecase', 'venn', 'cynefin', 'railroad'
] as const satisfies readonly (keyof MermaidConfig)[]

const token = (style: CSSStyleDeclaration, name: string) => style.getPropertyValue(name).trim()

export type Palette = 'light' | 'dark'
const darkQuery = () => matchMedia('(prefers-color-scheme: dark)')
export const paletteNow = (): Palette => (darkQuery().matches ? 'dark' : 'light')
export const watchPalette = (listener: () => void) => {
  const query = darkQuery()
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

function configFromPage(): MermaidConfig {
  const style = getComputedStyle(document.documentElement)
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    // Labels as SVG text where Mermaid allows it. It still draws some, such as math and event model boxes, as HTML in a foreignObject, which the sanitizer keeps.
    htmlLabels: false,
    secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'suppressErrorRendering', 'maxEdges', 'htmlLabels'],
    ...Object.fromEntries(DIAGRAM_CONFIGS.map(kind => [kind, { useMaxWidth: false }])),
    theme: 'base',
    fontFamily: token(style, '--sans'),
    // Mermaid derives its shades from hex values, so it gets the page's tokens resolved, not var() references.
    themeVariables: {
      background: token(style, '--sheet'),
      primaryColor: token(style, '--signal-soft'),
      primaryBorderColor: token(style, '--signal'),
      primaryTextColor: token(style, '--ink'),
      secondaryColor: token(style, '--caution-soft'),
      tertiaryColor: token(style, '--paper'),
      lineColor: token(style, '--graphite'),
      edgeLabelBackground: token(style, '--sheet'),
      textColor: token(style, '--ink'),
      fontFamily: token(style, '--sans')
    }
  }
}

export type SanitizedSvg = string & { readonly __brand: 'SanitizedSvg' }

export type Drawing = { readonly status: 'drawing' } | { readonly status: 'drawn'; readonly svg: SanitizedSvg } | { readonly status: 'failed' }

const DRAWING: Drawing = { status: 'drawing' }
const FAILED: Drawing = { status: 'failed' }

interface Drawer {
  readonly mermaid: Mermaid
  readonly sanitize: (svg: string) => SanitizedSvg
  configured: Palette | null
}

let drawer: Promise<Drawer> | undefined

function loadDrawer(): Promise<Drawer> {
  drawer ??= Promise.all([import('mermaid'), import('dompurify')]).then(([{ default: mermaid }, { default: purify }]) => ({
    mermaid,
    sanitize: svg => purify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true, html: true, mathMl: true }, ADD_TAGS: ['foreignObject'], HTML_INTEGRATION_POINTS: { 'annotation-xml': true, foreignobject: true } }) as SanitizedSvg,
    configured: null
  }))
  return drawer
}

const drawn = new Map<string, Drawing>()
const keyOf = (source: string, palette: Palette) => `${palette}\n${source}`
let renders = 0

export function drawnBefore(source: string, palette: Palette): Drawing {
  return drawn.get(keyOf(source, palette)) ?? DRAWING
}

let turn: Promise<unknown> = Promise.resolve()

/** Mermaid queues a render but applies `initialize` at once, so a palette and the renders drawn in it take one turn together. */
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = turn.then(work)
  turn = next.catch(() => {})
  return next
}

export async function drawDiagram(source: string): Promise<Drawing> {
  const known = drawn.get(keyOf(source, paletteNow()))
  if (known !== undefined) return known
  const { palette, drawing } = source.length > MAX_DIAGRAM_CHARS
    ? { palette: paletteNow(), drawing: FAILED }
    : await inTurn(async () => {
      try {
        const loaded = await loadDrawer()
        const palette = paletteNow()
        if (loaded.configured !== palette) {
          loaded.mermaid.initialize(configFromPage())
          loaded.configured = palette
        }
        return { palette, drawing: { status: 'drawn', svg: loaded.sanitize((await loaded.mermaid.render(`diagram-${++renders}`, source)).svg) } satisfies Drawing }
      } catch {
        return { palette: paletteNow(), drawing: FAILED }
      }
    })
  if (drawn.size >= CACHE_LIMIT) drawn.delete(drawn.keys().next().value!)
  drawn.set(keyOf(source, palette), drawing)
  return drawing
}

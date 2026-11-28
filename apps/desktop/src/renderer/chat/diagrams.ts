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
/**
 * Mermaid parses plain colors only, and a Contrast other than 100 draws the quiet colors as a mix. A canvas reads a mix back as
 * `color(srgb …)`, so the mix is painted and its pixel read.
 */
function plain(color: string): string {
  const canvas = color.startsWith('color-mix(') ? document.createElement('canvas') : null
  const paint = canvas?.getContext('2d', { willReadFrequently: true }) ?? null
  if (paint === null) return color
  paint.fillStyle = color
  paint.fillRect(0, 0, 1, 1)
  return `#${[...paint.getImageData(0, 0, 1, 1).data.slice(0, 3)].map(channel => channel.toString(16).padStart(2, '0')).join('')}`
}

export type Palette = 'light' | 'dark'
const darkQuery = () => matchMedia('(prefers-color-scheme: dark)')
const paletteNow = (): Palette => (darkQuery().matches ? 'dark' : 'light')
const watchPalette = (listener: () => void) => {
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
      lineColor: plain(token(style, '--graphite')),
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
  configured: string | null
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
/** Beside the palette, the config reads the interface face and the line color, which Settings → Appearance sets on the root's style. */
export const lookOf = (palette: Palette) => {
  const style = getComputedStyle(document.documentElement)
  return `${palette}\n${token(style, '--sans')}\n${token(style, '--graphite')}`
}
export const lookNow = () => lookOf(paletteNow())
export const watchLook = (listener: () => void) => {
  const stopPalette = watchPalette(listener)
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
  return () => {
    stopPalette()
    observer.disconnect()
  }
}
const keyOf = (source: string, look: string) => `${look}\n${source}`
let renders = 0

export function drawnBefore(source: string, look: string): Drawing {
  return drawn.get(keyOf(source, look)) ?? DRAWING
}

let turn: Promise<unknown> = Promise.resolve()

/** Mermaid queues a render but applies `initialize` at once, so a palette and the renders drawn in it take one turn together. */
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const next = turn.then(work)
  turn = next.catch(() => {})
  return next
}

export async function drawDiagram(source: string): Promise<Drawing> {
  const known = drawn.get(keyOf(source, lookNow()))
  if (known !== undefined) return known
  const { look, drawing } = source.length > MAX_DIAGRAM_CHARS
    ? { look: lookNow(), drawing: FAILED }
    : await inTurn(async () => {
      try {
        const loaded = await loadDrawer()
        const look = lookNow()
        if (loaded.configured !== look) {
          loaded.mermaid.initialize(configFromPage())
          loaded.configured = look
        }
        return { look, drawing: { status: 'drawn', svg: loaded.sanitize((await loaded.mermaid.render(`diagram-${++renders}`, source)).svg) } satisfies Drawing }
      } catch {
        return { look: lookNow(), drawing: FAILED }
      }
    })
  if (drawn.size >= CACHE_LIMIT) drawn.delete(drawn.keys().next().value!)
  drawn.set(keyOf(source, look), drawing)
  return drawing
}

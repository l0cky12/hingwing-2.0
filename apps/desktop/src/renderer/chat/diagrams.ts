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
}

let drawer: Promise<Drawer> | undefined

function loadDrawer(): Promise<Drawer> {
  drawer ??= Promise.all([import('mermaid'), import('dompurify')]).then(([{ default: mermaid }, { default: purify }]) => {
    mermaid.initialize(configFromPage())
    return { mermaid, sanitize: svg => purify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true, html: true, mathMl: true }, ADD_TAGS: ['foreignObject'], HTML_INTEGRATION_POINTS: { 'annotation-xml': true, foreignobject: true } }) as SanitizedSvg }
  })
  return drawer
}

const drawn = new Map<string, Drawing>()
let renders = 0

export function drawnBefore(source: string): Drawing {
  return drawn.get(source) ?? DRAWING
}

export async function drawDiagram(source: string): Promise<Drawing> {
  const known = drawn.get(source)
  if (known !== undefined) return known
  let drawing = FAILED
  if (source.length <= MAX_DIAGRAM_CHARS) {
    try {
      const { mermaid, sanitize } = await loadDrawer()
      drawing = { status: 'drawn', svg: sanitize((await mermaid.render(`diagram-${++renders}`, source)).svg) }
    } catch {
      drawing = FAILED
    }
  }
  if (drawn.size >= CACHE_LIMIT) drawn.delete(drawn.keys().next().value!)
  drawn.set(source, drawing)
  return drawing
}

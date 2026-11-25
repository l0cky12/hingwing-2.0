import katex from 'katex'

const typesetCache = new Map<string, string | null>()
const CACHE_LIMIT = 300

function htmlOf(tex: string, display: boolean): string | null {
  const key = `${display ? 'D' : 'I'}${tex}`
  const cached = typesetCache.get(key)
  if (cached !== undefined) return cached
  let html: string | null
  try {
    html = katex.renderToString(tex, { displayMode: display, throwOnError: true, output: 'html', strict: 'ignore' })
  } catch {
    html = null
  }
  if (typesetCache.size >= CACHE_LIMIT) typesetCache.delete(typesetCache.keys().next().value!)
  typesetCache.set(key, html)
  return html
}

export function Formula({ tex, display }: { readonly tex: string; readonly display: boolean }) {
  const html = htmlOf(tex, display)
  return html === null
    ? <code className="math" role="math" aria-label={tex} data-find-text={tex}>{tex}</code>
    : <span className="math" role="math" aria-label={tex} data-find-text={tex}><span aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} /></span>
}

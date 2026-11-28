import { parsePluginCatalog, type CatalogPlugin, type CommandOutcome } from '@highwing/hermes/domain'
import { webFetch } from './images'

/** The snapshot Hermes desktop browses (apps/desktop/src/app/capabilities/catalog/catalog-data.ts). The gateway has no call that lists the catalog. */
export const CATALOG_URL = 'https://nousresearch.github.io/hermes-agent/docs/api/plugins.json'
/** As long as Hermes desktop keeps its copy. */
export const KEEP_MS = 30 * 60_000
const WEB_TIMEOUT_MS = 60_000

const NOT_LOADED: CommandOutcome<never> = { ok: false, refusal: { kind: 'rejected', message: "Highwing couldn't load Hermes's plugin catalog." } }

export interface CatalogDeps {
  fetchWeb(url: string, signal: AbortSignal): Promise<Response>
  now(): number
  readonly timeoutMs: number
}

export interface PluginCatalog { read(): Promise<CommandOutcome<readonly CatalogPlugin[]>> }

async function load(deps: CatalogDeps): Promise<CommandOutcome<readonly CatalogPlugin[]>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs)
  try {
    const response = await deps.fetchWeb(CATALOG_URL, controller.signal)
    const plugins = response.ok ? parsePluginCatalog(await response.json()) : null
    return plugins === null ? NOT_LOADED : { ok: true, value: plugins }
  } catch {
    return NOT_LOADED
  } finally {
    clearTimeout(timer)
  }
}

export function pluginCatalog(deps: CatalogDeps): PluginCatalog {
  let kept: { readonly at: number; readonly plugins: readonly CatalogPlugin[] } | null = null
  let reading: Promise<CommandOutcome<readonly CatalogPlugin[]>> | null = null
  return {
    read() {
      if (kept !== null && deps.now() - kept.at < KEEP_MS) return Promise.resolve({ ok: true, value: kept.plugins })
      reading ??= load(deps).then(outcome => {
        reading = null
        if (outcome.ok) kept = { at: deps.now(), plugins: outcome.value }
        return outcome
      })
      return reading
    }
  }
}

export function desktopCatalogDeps(net: Pick<Electron.Net, 'fetch'>): CatalogDeps {
  return { fetchWeb: webFetch(net), now: Date.now, timeoutMs: WEB_TIMEOUT_MS }
}

export function fixtureCatalogDeps(rows: readonly unknown[] | undefined): CatalogDeps {
  return {
    fetchWeb: async () => (rows === undefined ? new Response(null, { status: 404 }) : new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } })),
    now: Date.now,
    timeoutMs: WEB_TIMEOUT_MS
  }
}

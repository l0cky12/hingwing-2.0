/** One of Hermes's toolsets: a named group of tools a chat can use. `toolCount` is Hermes's count, which `tools` may not reach. */
export interface Toolset {
  readonly name: string
  /** Hermes's label ("Web Search & Scraping"). `tools.list` sends none, so it is `name` there. */
  readonly label: string
  /** The platform of a toolset that is not for the chat ("Discord"), else null. */
  readonly place: string | null
  readonly description: string
  readonly tools: readonly string[]
  readonly toolCount: number
  readonly enabled: boolean
}

/** What the Tools tab reads. `locked` null: every toolset has a switch. Otherwise the words that say why none has. */
export interface ToolsetsRead {
  readonly toolsets: readonly Toolset[]
  readonly locked: string | null
}

export interface ToolsetSwitched {
  readonly name: string
  readonly enabled: boolean
}

/** Hermes's dashboard routes (hermes_cli/web_routers/tools.py:224-336). `PUT` takes `{ enabled }` and writes only the profile the request names. */
export const TOOLSETS_PATH = '/api/tools/toolsets'
export const toolsetPath = (name: string): string => `${TOOLSETS_PATH}/${encodeURIComponent(name)}`

type Obj = Readonly<Record<string, unknown>>
const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)
const words = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null)

/**
 * The rows of `GET /api/tools/toolsets` (tools.py:224-271), whose `platform` is `cli` for the chat's toolsets. A row with no name is
 * dropped, and a blank tool name with it. null: the body is not a list.
 */
export function parseBotToolsets(body: unknown): readonly Toolset[] | null {
  if (!Array.isArray(body)) return null
  return body.filter(isObject).flatMap(row => {
    const name = words(row.name)
    if (name === null) return []
    const tools = (Array.isArray(row.tools) ? row.tools : []).flatMap(tool => words(tool) ?? [])
    const platform = words(row.platform)
    return [{
      name,
      label: words(row.label) ?? name,
      place: platform === null || platform === 'cli' ? null : words(row.platform_label) ?? platform,
      description: words(row.description) ?? '',
      tools,
      toolCount: tools.length,
      enabled: row.enabled === true
    }]
  })
}

/** What the `PUT` answered: `{ ok: true, name, platform, enabled, post_setup_started }` (tools.py:274-336). null: no such reply. */
export function parseToolsetSwitched(body: unknown, asked: ToolsetSwitched): ToolsetSwitched | null {
  if (!isObject(body) || body.ok !== true) return null
  return { name: words(body.name) ?? asked.name, enabled: typeof body.enabled === 'boolean' ? body.enabled : asked.enabled }
}

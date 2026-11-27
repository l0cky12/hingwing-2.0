/**
 * The fake Hermes's `mcp.servers.*` (tui_gateway/methods_tools.py:1470-1612): each profile's configured servers, which an add
 * or a remove changes, and the probe a test answers with.
 */
import type { McpServerSeed, McpScript } from './fixture'

type Obj = Readonly<Record<string, unknown>>
type Refuse = (code: number, message: string) => never

const isObject = (value: unknown): value is Obj => value !== null && typeof value === 'object' && !Array.isArray(value)
const textOf = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

/** `summarize_server` (tui_gateway/mcp_rpc_helpers.py:32-54): no header value and no env value leaves Hermes. */
function summary(server: McpServerSeed) {
  return {
    name: server.name, transport: server.url !== undefined ? 'http' : 'stdio', url: server.url ?? null, command: server.command ?? null, args: [...(server.args ?? [])],
    env: [], auth: server.headers !== undefined && Object.keys(server.headers).some(key => key.toLowerCase() === 'authorization') ? 'header' : null,
    enabled: server.status !== 'disabled', tools: null, source: server.plugin === undefined ? 'config' : 'plugin', plugin: server.plugin ?? null
  }
}

export class ScriptedToolServers {
  private readonly held = new Map<string, McpServerSeed[]>()

  constructor(private readonly script: McpScript, private readonly refuse: Refuse) {}

  call(method: string, params: Obj, profile: string): unknown {
    const servers = this.serversOf(profile)
    const name = textOf(params.name)
    switch (method) {
      case 'mcp.servers.list': return { servers: [...servers].sort((a, b) => a.name.localeCompare(b.name)).map(summary) }
      case 'mcp.servers.status': return {
        servers: servers.map(server => ({
          name: server.name, transport: summary(server).transport, tools: server.tools ?? 0, connected: server.status === 'connected', disabled: server.status === 'disabled',
          status: server.status ?? 'configured', needs_auth: server.needs_auth ?? false, source: summary(server).source, plugin: server.plugin ?? null
        })),
        checked_at: 0
      }
      case 'mcp.servers.add': return this.add(servers, name, params.config)
      case 'mcp.servers.test': return this.test(servers, name)
      case 'mcp.servers.remove': return this.remove(servers, name)
      default: return this.refuse(-32601, `unknown method: ${method}`)
    }
  }

  private serversOf(profile: string): McpServerSeed[] {
    let servers = this.held.get(profile)
    if (servers === undefined) {
      servers = [...(this.script.servers[profile] ?? [])]
      this.held.set(profile, servers)
    }
    return servers
  }

  private add(servers: McpServerSeed[], name: string, raw: unknown): unknown {
    const held = servers.find(server => server.name === name)
    if (held?.plugin !== undefined) this.refuse(4090, `server '${name}' is provided by plugin '${held.plugin}' and cannot be modified`)
    if (held !== undefined) this.refuse(4090, `server '${name}' already exists`)
    const config = isObject(raw) ? raw : {}
    const url = textOf(config.url)
    const command = textOf(config.command)
    if (url === '' && command === '') this.refuse(4063, "config must specify a 'url' (http) or 'command' (stdio), or a valid 'preset'")
    const headers = isObject(config.headers) ? Object.fromEntries(Object.entries(config.headers).map(([key, value]) => [key, String(value)])) : undefined
    const args = Array.isArray(config.args) ? config.args.map(String) : undefined
    const added: McpServerSeed = url !== '' ? { name, url, ...(headers === undefined ? {} : { headers }) } : { name, command, ...(args === undefined ? {} : { args }) }
    servers.push(added)
    return { ok: true, name, server: summary(added) }
  }

  private test(servers: McpServerSeed[], name: string): unknown {
    if (!servers.some(server => server.name === name)) this.refuse(4064, `server '${name}' not found`)
    const probe = this.script.probes?.[name]
    if (probe !== undefined && 'tools' in probe) {
      return { ok: true, tools: probe.tools.map(tool => ({ name: tool, description: '' })), prompts: 0, resources: 0, oauth_needed: false, oauth_tokens_present: null }
    }
    if (probe !== undefined && 'oauth_needed' in probe) {
      return { ok: false, error: 'OAuth authentication required — no token found.', tools: [], oauth_needed: true, oauth_tokens_present: false }
    }
    return { ok: false, error: probe?.error ?? 'Connection refused', tools: [], oauth_needed: false, oauth_tokens_present: null }
  }

  private remove(servers: McpServerSeed[], name: string): unknown {
    const at = servers.findIndex(server => server.name === name)
    if (at >= 0 && servers[at]?.plugin !== undefined) this.refuse(4090, `server '${name}' is provided by plugin '${servers[at]?.plugin}' and cannot be modified`)
    if (at < 0) this.refuse(4064, `server '${name}' not found`)
    servers.splice(at, 1)
    return { ok: true, removed: true }
  }
}

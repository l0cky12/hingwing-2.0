import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CONTRACT_FILES, type ContractVersion, installedHermes, VERSION_FILE, WIRE_DIR } from './hermes-install'

interface Entry {
  readonly name: string
}

interface OpenRpc {
  readonly methods: readonly Entry[]
  readonly 'x-canonical-methods': readonly Entry[]
  readonly 'x-server-requests': readonly Entry[]
  readonly 'x-notifications': readonly Entry[]
  readonly components: { readonly schemas: Readonly<Record<string, unknown>> }
}

const SECTIONS = [
  ['x-canonical-methods', 'canonical methods'],
  ['methods', 'methods'],
  ['x-server-requests', 'server requests'],
  ['x-notifications', 'event types']
] as const

const [generated, openrpc] = CONTRACT_FILES
const hermes = installedHermes()
const vendoredVersion = JSON.parse(readFileSync(VERSION_FILE, 'utf8')) as ContractVersion
const read = (path: string) => readFileSync(path, 'utf8')
const vendored = JSON.parse(read(join(WIRE_DIR, openrpc.vendored))) as OpenRpc
const installed = JSON.parse(read(join(hermes.dir, openrpc.hermes))) as OpenRpc

function expand(value: unknown, schemas: OpenRpc['components']['schemas'], seen: ReadonlySet<string> = new Set()): unknown {
  if (Array.isArray(value)) return value.map(item => expand(item, schemas, seen))
  if (value === null || typeof value !== 'object') return value
  const ref = (value as { $ref?: unknown }).$ref
  if (typeof ref === 'string' && ref.startsWith('#/components/schemas/')) {
    const name = ref.slice('#/components/schemas/'.length)
    return seen.has(name) ? value : expand(schemas[name], schemas, new Set([...seen, name]))
  }
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, expand(item, schemas, seen)]))
}

function shapes(doc: OpenRpc, section: (typeof SECTIONS)[number][0]): Map<string, string> {
  return new Map(doc[section].map(entry => [entry.name, JSON.stringify(expand(entry, doc.components.schemas))]))
}

const report: string[] = []
for (const [section, label] of SECTIONS) {
  const before = shapes(vendored, section)
  const after = shapes(installed, section)
  const added = [...after.keys()].filter(name => !before.has(name))
  const removed = [...before.keys()].filter(name => !after.has(name))
  const changed = [...after.keys()].filter(name => before.has(name) && before.get(name) !== after.get(name))
  for (const [verb, names] of [['added', added], ['removed', removed], ['changed', changed]] as const) {
    if (names.length > 0) report.push(`${label} ${verb}: ${names.sort().join(', ')}`)
  }
}
if (read(join(WIRE_DIR, generated.vendored)) !== read(join(hermes.dir, generated.hermes))) {
  report.push(`${generated.vendored} differs from the installed ${generated.hermes}`)
}

const from = `Hermes ${vendoredVersion.hermes} (${vendoredVersion.commit.slice(0, 12)})`
const to = `Hermes ${hermes.version} (${hermes.commit.slice(0, 12)})`
if (report.length === 0) {
  console.log(`no difference: the vendored contract of ${from} matches the installed ${to}`)
} else {
  console.log(`The vendored contract of ${from} differs from the installed ${to}:`)
  for (const line of report) console.log(`  ${line}`)
  console.log('Run `pnpm sync:contract` to take the installed contract, then fix what no longer type-checks.')
  process.exitCode = 1
}

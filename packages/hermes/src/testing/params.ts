/**
 * The canonical dispatcher's param check, `canonical_param_problems` in Hermes's
 * `tui_gateway/contracts/registry.py:154-166`, run over the vendored OpenRPC document.
 */
import { readFileSync } from 'node:fs'

interface Schema {
  readonly $ref?: string
  readonly type?: string
  readonly anyOf?: readonly Schema[]
  readonly enum?: readonly unknown[]
  readonly const?: unknown
  readonly items?: Schema
  readonly properties?: Readonly<Record<string, Schema>>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean | Schema
}

interface MethodEntry {
  readonly name: string
  readonly params: readonly [{ readonly schema: Schema }]
}

interface OpenRpc {
  readonly methods: readonly MethodEntry[]
  readonly 'x-canonical-methods': readonly MethodEntry[]
  readonly components: { readonly schemas: Readonly<Record<string, Schema>> }
}

/** `shared`: the legacy sidecar declares the name too. `null`: only the sidecar does, and the dispatcher checks nothing. */
type Contract = { readonly schema: Schema; readonly shared: boolean } | null

interface Problem {
  readonly path: string
  readonly kind: 'extra' | 'missing' | 'value'
}

let loaded: { readonly doc: OpenRpc; readonly contracts: ReadonlyMap<string, Contract> } | undefined

function load() {
  if (loaded !== undefined) return loaded
  const doc = JSON.parse(readFileSync(new URL('../wire/contract.openrpc.json', import.meta.url), 'utf8')) as OpenRpc
  const contracts = new Map<string, Contract>(doc.methods.map(entry => [entry.name, null]))
  for (const entry of doc['x-canonical-methods']) {
    contracts.set(entry.name, { schema: entry.params[0].schema, shared: contracts.has(entry.name) })
  }
  return (loaded = { doc, contracts })
}

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isWhole = (value: unknown) => typeof value === 'number' && Number.isInteger(value)

const BOOLEAN_WORDS = new Set(['0', 'off', 'f', 'false', 'n', 'no', '1', 'on', 't', 'true', 'y', 'yes'])

/**
 * The contract models validate in pydantic's lax mode, so a value pydantic coerces is accepted:
 * `"1"` and `true` for an integer, `"yes"` and `1` for a boolean. A string takes only a string.
 */
const ACCEPTS: Readonly<Record<string, (value: unknown) => boolean>> = {
  string: value => typeof value === 'string',
  integer: value => isWhole(value) || typeof value === 'boolean' || (typeof value === 'string' && /^\s*[+-]?\d+\s*$/.test(value)),
  number: value => typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))),
  boolean: value => typeof value === 'boolean' || value === 0 || value === 1 || (typeof value === 'string' && BOOLEAN_WORDS.has(value.toLowerCase())),
  null: value => value === null,
  array: Array.isArray,
  object: isObject
}

function problemsIn(doc: OpenRpc, schema: Schema, value: unknown, path: string): readonly Problem[] {
  if (schema.$ref !== undefined) {
    const target = doc.components.schemas[schema.$ref.slice(schema.$ref.lastIndexOf('/') + 1)]
    if (target === undefined) throw new Error(`contract.openrpc.json names a missing schema ${schema.$ref}`)
    return problemsIn(doc, target, value, path)
  }
  if (schema.anyOf !== undefined) {
    const branches = schema.anyOf.map(branch => problemsIn(doc, branch, value, path))
    if (branches.some(found => found.length === 0)) return []
    // A container that matched a branch's type reports that branch's inner paths, as pydantic does.
    return branches.find(found => found.every(problem => problem.path !== path)) ?? [{ path, kind: 'value' }]
  }
  const wrong: readonly Problem[] = [{ path, kind: 'value' }]
  if (schema.enum !== undefined) return schema.enum.includes(value) ? [] : wrong
  if ('const' in schema) return schema.const === value ? [] : wrong
  if (schema.type === undefined) return []
  if (ACCEPTS[schema.type]?.(value) !== true) return wrong
  const at = (key: string | number) => (path === '' ? String(key) : `${path}.${key}`)
  if (Array.isArray(value)) {
    const { items } = schema
    return items === undefined ? [] : value.flatMap((item, index) => problemsIn(doc, items, item, at(index)))
  }
  if (!isObject(value)) return []
  const { properties = {}, required = [], additionalProperties } = schema
  return [
    ...Object.entries(value).flatMap(([key, held]): readonly Problem[] => {
      const known = properties[key]
      if (known !== undefined) return problemsIn(doc, known, held, at(key))
      if (additionalProperties === false) return [{ path: at(key), kind: 'extra' }]
      return isObject(additionalProperties) ? problemsIn(doc, additionalProperties, held, at(key)) : []
    }),
    ...required.filter(key => !(key in value)).map((key): Problem => ({ path: at(key), kind: 'missing' }))
  ]
}

/**
 * The key paths the dispatcher refuses with `4001 invalid_params` before any handler runs, or
 * `undefined` for a method the contract does not declare.
 *
 * A name the sidecar shares (`prompt.submit`, `approval.respond`, `session.create`, `session.resume`,
 * ...) is refused for an unknown key or a value of the wrong type. A missing key is left to its
 * handler. A canonical-only name (`clarify.respond`, `session.detach`, ...) is refused for an
 * unknown or a missing key, and its values are left to its handler.
 */
export function checkParams(method: string, params: unknown): readonly string[] | undefined {
  const { doc, contracts } = load()
  const contract = contracts.get(method)
  if (contract === undefined) return undefined
  if (params !== undefined && params !== null && !isObject(params)) return ['params']
  if (contract === null) return []
  const refused: readonly Problem['kind'][] = contract.shared ? ['extra', 'value'] : ['extra', 'missing']
  return problemsIn(doc, contract.schema, params ?? {}, '').filter(problem => refused.includes(problem.kind)).map(problem => problem.path || 'params')
}

/**
 * The gateway's closed key sets, read from the vendored `wire/contract.openrpc.json`, never listed by hand.
 * The scripted gateway refuses a call with these, and fixture tests check recorded params with them.
 */
import { readFileSync } from 'node:fs'

interface Schema {
  readonly properties?: Readonly<Record<string, unknown>>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean
}

interface MethodEntry {
  readonly name: string
  readonly params: readonly [{ readonly schema: { readonly $ref: string } }]
}

interface OpenRpc {
  readonly methods: readonly MethodEntry[]
  readonly 'x-canonical-methods': readonly MethodEntry[]
  readonly components: { readonly schemas: Readonly<Record<string, Schema>> }
}

interface KeySet {
  readonly canonical: boolean
  readonly schema: Schema
}

let keySets: ReadonlyMap<string, KeySet> | undefined

function load(): ReadonlyMap<string, KeySet> {
  if (keySets !== undefined) return keySets
  const doc = JSON.parse(readFileSync(new URL('../wire/contract.openrpc.json', import.meta.url), 'utf8')) as OpenRpc
  const schemaOf = (entry: MethodEntry) => {
    const ref = entry.params[0].schema.$ref
    const schema = doc.components.schemas[ref.slice(ref.lastIndexOf('/') + 1)]
    if (schema === undefined) throw new Error(`contract.openrpc.json: ${entry.name} names a missing schema ${ref}`)
    return schema
  }
  const sets = new Map<string, KeySet>()
  for (const entry of doc.methods) sets.set(entry.name, { canonical: false, schema: schemaOf(entry) })
  // The canonical dispatcher looks a method up here first (gateway/session_controls.py `dispatch`).
  for (const entry of doc['x-canonical-methods']) sets.set(entry.name, { canonical: true, schema: schemaOf(entry) })
  return (keySets = sets)
}

/**
 * The keys the gateway refuses in `params` for `method`, as the `fields` of its 4001 `invalid_params`
 * error: unknown keys, and for a canonical method also missing required keys
 * (`tui_gateway/contracts/registry.py` `canonical_param_problems`). Empty when the key set is accepted.
 * `undefined` when the contract has no such method, which the gateway answers with -32601.
 * Values are not checked; the gateway's handlers own those refusals.
 */
export function checkParams(method: string, params: unknown): readonly string[] | undefined {
  const keySet = load().get(method)
  if (keySet === undefined) return undefined
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return ['params']
  const { properties = {}, required = [], additionalProperties } = keySet.schema
  const keys = Object.keys(params)
  const unknown = additionalProperties === false ? keys.filter(key => !(key in properties)) : []
  const missing = keySet.canonical ? required.filter(key => !keys.includes(key)) : []
  return [...unknown, ...missing]
}

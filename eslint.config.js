import tseslint from 'typescript-eslint'

const contract = { group: ['**/contract.generated*', '**/contract.openrpc.json'], message: 'Gateway shapes stay inside wire/ and testing/.' }

export default tseslint.config(
  { ignores: ['docs/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['packages/hermes/src/domain/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['../*', 'node:*', '@highwing/*'], message: 'domain/ imports nothing outside itself.' }] }] }
  },
  {
    files: ['packages/hermes/src/**'],
    ignores: ['packages/hermes/src/wire/**', 'packages/hermes/src/testing/**', 'packages/hermes/src/domain/**'],
    rules: { 'no-restricted-imports': ['error', { paths: ['electron'], patterns: [contract] }] }
  },
  {
    files: ['packages/hermes/src/wire/**', 'packages/hermes/src/testing/**'],
    rules: { 'no-restricted-imports': ['error', { paths: ['electron'] }] }
  }
)

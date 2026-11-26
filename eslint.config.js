import tseslint from 'typescript-eslint'

const contract = { group: ['**/contract.generated*', '**/contract.openrpc.json'], message: 'Gateway shapes stay inside wire/ and testing/.' }

const TARGET_KIND = '/^(local|remote|url)$/'
const KIND = side => `[${side}.property.name='kind'], [${side}.property.value='kind'], [${side}.expression.property.name='kind'], [${side}.expression.property.value='kind'], [${side}.name='kind']`
const byKindOnly = 'Branch on a target with byKind from @highwing/hermes/domain, or a table keyed by Target[\'kind\'], so a new kind of target stops the build here.'

export default tseslint.config(
  { ignores: ['docs/**', '**/node_modules/**', 'apps/desktop/out/**', 'packages/hermes/src/wire/contract.generated.ts'] },
  ...tseslint.configs.recommended,
  {
    files: ['apps/**', 'packages/**', 'scripts/**'],
    ignores: ['packages/hermes/src/domain/reach.ts'],
    rules: {
      'no-restricted-syntax': ['error',
        { selector: `BinaryExpression[operator=/^[!=]==?$/]:matches([right.value=${TARGET_KIND}]:matches(${KIND('left')}), [left.value=${TARGET_KIND}]:matches(${KIND('right')}))`, message: byKindOnly },
        { selector: `SwitchStatement:matches(${KIND('discriminant')}) > SwitchCase[test.value=${TARGET_KIND}]`, message: byKindOnly }
      ]
    }
  },
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
    files: ['packages/thread/src/**'],
    rules: { 'no-restricted-imports': ['error', { patterns: [{ regex: '^(?!@highwing/hermes/domain$)(@highwing/|node:|\\.\\./)', message: '@highwing/thread imports @highwing/hermes/domain and nothing else.' }] }] }
  },
  {
    files: ['packages/hermes/src/wire/**', 'packages/hermes/src/testing/**'],
    rules: { 'no-restricted-imports': ['error', { paths: ['electron'] }] }
  },
  {
    files: ['apps/desktop/src/**'],
    ignores: ['apps/desktop/src/main/index.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: [{ name: '@highwing/hermes/testing', message: 'Only main/index.ts reads HIGHWING_FIXTURE and HIGHWING_RECORD.' }] }] }
  },
  {
    files: ['apps/desktop/src/main/settings.ts', 'apps/desktop/src/main/sign-ins.ts', 'apps/desktop/src/main/keyring.ts', 'apps/desktop/src/main/drafts.ts', 'apps/desktop/src/main/mode.ts', 'apps/desktop/src/main/connection.ts', 'apps/desktop/src/main/notify.ts', 'apps/desktop/src/main/links.ts', 'apps/desktop/src/main/context-menu.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: 'electron', message: 'The settings file, the sign-in store, the keyring check, the draft store, the mode store, the connection owner, the turn notices, the link intake and the context menu take what they need as arguments, so a test drives them with no Electron.' },
          { name: '@highwing/hermes/testing', message: 'Only main/index.ts reads HIGHWING_FIXTURE and HIGHWING_RECORD.' }
        ]
      }]
    }
  },
  {
    files: ['apps/desktop/src/renderer/**', 'apps/desktop/src/ipc-contract.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: ['@highwing/hermes', '@highwing/hermes/testing', 'electron'].map(name => ({ name, message: 'The renderer imports @highwing/hermes/domain, @highwing/thread and ipc-contract only.' })),
        patterns: [{ group: ['node:*'], message: 'The renderer has no Node.' }]
      }]
    }
  }
)

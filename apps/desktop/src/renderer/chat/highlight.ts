import type { HLJSApi, LanguageFn } from 'highlight.js'

const GRAMMARS = {
  typescript: () => import('highlight.js/lib/languages/typescript'),
  javascript: () => import('highlight.js/lib/languages/javascript'),
  bash: () => import('highlight.js/lib/languages/bash'),
  python: () => import('highlight.js/lib/languages/python'),
  json: () => import('highlight.js/lib/languages/json'),
  rust: () => import('highlight.js/lib/languages/rust'),
  go: () => import('highlight.js/lib/languages/go'),
  java: () => import('highlight.js/lib/languages/java'),
  kotlin: () => import('highlight.js/lib/languages/kotlin'),
  swift: () => import('highlight.js/lib/languages/swift'),
  c: () => import('highlight.js/lib/languages/c'),
  cpp: () => import('highlight.js/lib/languages/cpp'),
  csharp: () => import('highlight.js/lib/languages/csharp'),
  css: () => import('highlight.js/lib/languages/css'),
  scss: () => import('highlight.js/lib/languages/scss'),
  xml: () => import('highlight.js/lib/languages/xml'),
  yaml: () => import('highlight.js/lib/languages/yaml'),
  ini: () => import('highlight.js/lib/languages/ini'),
  sql: () => import('highlight.js/lib/languages/sql'),
  diff: () => import('highlight.js/lib/languages/diff'),
  markdown: () => import('highlight.js/lib/languages/markdown'),
  ruby: () => import('highlight.js/lib/languages/ruby'),
  php: () => import('highlight.js/lib/languages/php'),
  lua: () => import('highlight.js/lib/languages/lua'),
  dockerfile: () => import('highlight.js/lib/languages/dockerfile'),
  makefile: () => import('highlight.js/lib/languages/makefile'),
  powershell: () => import('highlight.js/lib/languages/powershell')
} satisfies Record<string, () => Promise<{ default: LanguageFn }>>

export type Grammar = keyof typeof GRAMMARS

const FENCES: Readonly<Record<string, Grammar>> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript', typescript: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', javascript: 'javascript',
  sh: 'bash', bash: 'bash', zsh: 'bash', shell: 'bash',
  py: 'python', python: 'python',
  json: 'json',
  rs: 'rust', rust: 'rust',
  go: 'go', golang: 'go',
  java: 'java',
  kt: 'kotlin', kotlin: 'kotlin',
  swift: 'swift',
  c: 'c', h: 'c',
  cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', hpp: 'cpp',
  cs: 'csharp', csharp: 'csharp',
  css: 'css',
  scss: 'scss',
  html: 'xml', xml: 'xml', svg: 'xml',
  yaml: 'yaml', yml: 'yaml',
  toml: 'ini', ini: 'ini',
  sql: 'sql',
  diff: 'diff', patch: 'diff',
  md: 'markdown', markdown: 'markdown',
  rb: 'ruby', ruby: 'ruby',
  php: 'php',
  lua: 'lua',
  dockerfile: 'dockerfile',
  makefile: 'makefile', make: 'makefile',
  ps1: 'powershell', powershell: 'powershell'
}

export const grammarFor = (lang: string | null): Grammar | null => (lang === null ? null : FENCES[lang.toLowerCase()] ?? null)

let core: Promise<HLJSApi> | undefined
let ready: HLJSApi | undefined
const loads = new Map<Grammar, Promise<void>>()

export function loadGrammar(grammar: Grammar): Promise<void> {
  let load = loads.get(grammar)
  if (load === undefined) {
    core ??= import('highlight.js/lib/core').then(module => module.default)
    load = Promise.all([core, GRAMMARS[grammar]()]).then(([hljs, language]) => {
      hljs.registerLanguage(grammar, language.default)
      ready = hljs
    })
    loads.set(grammar, load)
  }
  return load
}

/** The text as escaped HTML with a span per token, or null while its grammar has not loaded. */
export function highlight(text: string, grammar: Grammar): string | null {
  return ready?.getLanguage(grammar) === undefined ? null : ready.highlight(text, { language: grammar, ignoreIllegals: true }).value
}

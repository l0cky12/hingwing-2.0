import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const SCRIPT = fileURLToPath(new URL('./package-linux.mjs', import.meta.url))
const MANIFEST = { name: '@highwing/desktop', productName: 'Highwing', version: '0.1.0', type: 'module', main: 'out/main/index.js', private: true }

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))

/** A built app: `files` maps a path under `out/` to its contents. */
function builtApp(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'package-linux-'))
  roots.push(root)
  const app = join(root, 'app')
  const all = { 'main/index.js': 'import "electron"', 'preload/index.cjs': 'require("electron")', 'renderer/index.html': '<html></html>', ...files }
  for (const [path, contents] of Object.entries(all)) {
    mkdirSync(dirname(join(app, 'out', path)), { recursive: true })
    writeFileSync(join(app, 'out', path), contents)
  }
  writeFileSync(join(app, 'package.json'), JSON.stringify(MANIFEST))
  return { app, stage: join(root, 'stage') }
}

const run = (app: string, stage: string, ...extra: string[]) =>
  spawnSync(process.execPath, [SCRIPT, stage, '--app', app, ...extra], { encoding: 'utf8' })

describe('package-linux', () => {
  it('stages the build with a manifest that carries the product name and version', () => {
    const { app, stage } = builtApp({
      'main/index.js': 'import { app } from "electron"\nimport { join } from "node:path"\nconst fs = await import("fs/promises")',
      'preload/index.cjs': 'const { contextBridge } = require("electron")'
    })
    const result = run(app, stage, '--version', '0.1.0')
    expect(result.status).toBe(0)
    expect(existsSync(join(stage, 'out/renderer/index.html'))).toBe(true)
    expect(JSON.parse(readFileSync(join(stage, 'package.json'), 'utf8'))).toEqual({
      name: '@highwing/desktop', productName: 'Highwing', version: '0.1.0', type: 'module', main: 'out/main/index.js'
    })
  })

  it.each([
    ['a static import of a workspace package', 'main/index.js', 'import { openHermes } from "@highwing/hermes"', '@highwing/hermes'],
    ['a dynamic import of an npm package', 'main/chunk.js', 'const { WebSocketServer } = await import("ws")', 'ws'],
    ['a require of an npm package in the preload', 'preload/index.cjs', 'const react = require("react")', 'react'],
    ['a bundler __require of a workspace package', 'main/index.js', 'var __require = createRequire(import.meta.url)\nconst hermes = __require("@highwing/hermes")', '@highwing/hermes'],
    ['a re-export of an npm package', 'main/index.js', 'export { createRoot } from "react-dom/client"', 'react-dom/client']
  ])('fails on %s', (_name, file, source, specifier) => {
    const { app, stage } = builtApp({ [file]: source })
    const result = run(app, stage)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain(file)
    expect(result.stderr).toContain(specifier)
    expect(existsSync(stage)).toBe(false)
  })

  it('ignores a package name inside a string or a comment', () => {
    const { app, stage } = builtApp({ 'main/index.js': '// import "@highwing/hermes"\nconst note = "require(\'ws\')"\nconst other = "__require(\'react\')"' })
    expect(run(app, stage).status).toBe(0)
  })

  it('fails when the build output is missing', () => {
    const { app, stage } = builtApp({})
    rmSync(join(app, 'out'), { recursive: true })
    const result = run(app, stage)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('pnpm --filter @highwing/desktop build')
  })

  it('fails when the package version differs from the app version', () => {
    const { app, stage } = builtApp({})
    const result = run(app, stage, '--version', '9.9.9')
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('9.9.9')
  })
})
